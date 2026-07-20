import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  SettingsManager,
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme
} from "@earendil-works/pi-coding-agent";
import { Text, type TUI } from "@earendil-works/pi-tui";
import { parseRecapCommand } from "./commands.js";
import {
  isVersionAtLeast,
  loadRecapConfig,
  REQUIRED_PI_VERSION,
  type RecapConfig,
  saveRecapConfig,
  type StoredThinkingLevel
} from "./config.js";
import { buildRecentConversationText } from "./conversation.js";
import type { PreflightResult, RecapTrigger, SimpleCompletionFn } from "./generate.js";
import type { RecapSettingsMenuDeps } from "./settings-menu.js";

interface RecapWidgetState {
  text: string | null;
  loading: boolean;
}

interface SettingsSource {
  getGlobalSettings(): unknown;
}

export interface RecapRuntimeModules {
  clampThinkingLevel(model: Model<Api>, level: StoredThinkingLevel): ModelThinkingLevel;
  preflightRecap(
    config: RecapConfig,
    trigger: RecapTrigger,
    deps: {
      registry: ExtensionContext["modelRegistry"];
      notify(message: string, type: "info" | "warning" | "error"): void;
      saveConfig(config: RecapConfig): void;
    }
  ): Promise<PreflightResult>;
  generateRecapText: typeof import("./generate.js").generateRecapText;
  normalizeRecapText: typeof import("./generate.js").normalizeRecapText;
  enforceWordLimit: typeof import("./generate.js").enforceWordLimit;
  openRecapSettingsMenu(deps: RecapSettingsMenuDeps): Promise<void>;
}

export type RecapModuleLoader = () => RecapRuntimeModules | Promise<RecapRuntimeModules>;

export interface RecapTimerFacade {
  setTimeout(callback: () => void, delayMs: number): object;
  clearTimeout(handle: object): void;
}

export interface PiRecapDependencies {
  version?: string;
  moduleLoader?: RecapModuleLoader;
  settingsSourceFactory?: (cwd: string, agentDir?: string) => SettingsSource;
  agentDir?: string;
  timers?: RecapTimerFacade;
  completion?: SimpleCompletionFn;
}

export interface PiRecapRuntimeState {
  alive: boolean;
  pending: boolean;
  lastRecapEntryId: string | null;
  lastRecapText: string | null;
  autoRecapEnabled: boolean;
  currentIdleDelaySeconds: number;
  idleTimerScheduled: boolean;
}

export interface PiRecapRegistration {
  inspect(): PiRecapRuntimeState;
  waitForBackgroundTasks(): Promise<void>;
}

const SPINNER = [
  "\u280B",
  "\u2819",
  "\u2839",
  "\u2838",
  "\u283C",
  "\u2834",
  "\u2826",
  "\u2827",
  "\u2807",
  "\u280F"
];
const SPIN_INTERVAL_MS = 80;

const DEFAULT_TIMERS: RecapTimerFacade = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
};

async function defaultModuleLoader(): Promise<RecapRuntimeModules> {
  const [ai, generate, settingsMenu] = await Promise.all([
    import("@earendil-works/pi-ai"),
    import("./generate.js"),
    import("./settings-menu.js")
  ]);
  return {
    clampThinkingLevel: ai.clampThinkingLevel,
    preflightRecap: generate.preflightRecap,
    generateRecapText: generate.generateRecapText,
    normalizeRecapText: generate.normalizeRecapText,
    enforceWordLimit: generate.enforceWordLimit,
    openRecapSettingsMenu: settingsMenu.openRecapSettingsMenu
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRecapWidgetRenderer(): {
  render(ctx: Pick<ExtensionContext, "ui">, state: RecapWidgetState): void;
  reset(): void;
} {
  let recapWidgetTui: TUI | null = null;
  let recapWidgetText: Text | null = null;
  let spinInterval: ReturnType<typeof setInterval> | null = null;
  let spinFrame = 0;
  let recapTheme: Pick<Theme, "fg"> | null = null;

  const spinLabel = (): string => {
    const label = `${SPINNER[spinFrame]} Recap: generating...`;
    return recapTheme ? recapTheme.fg("dim", label) : label;
  };

  const stopSpinner = (): void => {
    if (spinInterval === null) return;
    clearInterval(spinInterval);
    spinInterval = null;
  };

  const startSpinner = (): void => {
    if (spinInterval !== null) return;
    spinFrame = 0;
    spinInterval = setInterval(() => {
      spinFrame = (spinFrame + 1) % SPINNER.length;
      recapWidgetText?.setText(spinLabel());
      recapWidgetTui?.requestRender();
    }, SPIN_INTERVAL_MS);
  };

  const reset = (): void => {
    stopSpinner();
    spinFrame = 0;
    recapWidgetTui = null;
    recapWidgetText = null;
    recapTheme = null;
  };

  const render = (ctx: Pick<ExtensionContext, "ui">, state: RecapWidgetState): void => {
    if (state.text === null && !state.loading) {
      ctx.ui.setWidget("pi-recap", undefined);
      reset();
      return;
    }

    if (state.loading) spinFrame = 0;

    ctx.ui.setWidget(
      "pi-recap",
      (tui, theme) => {
        recapWidgetTui = tui;
        recapTheme = theme;

        if (state.loading) {
          recapWidgetText = new Text(spinLabel(), 1, 1);
          return recapWidgetText;
        }
        recapWidgetText = null;
        return new Text(theme.fg("dim", `Recap: ${state.text ?? ""}`), 1, 1);
      },
      { placement: "aboveEditor" }
    );

    if (state.loading) {
      startSpinner();
    } else {
      stopSpinner();
    }
  };

  return { render, reset };
}

function modelLabel(config: RecapConfig): string {
  return config.recapModel === null
    ? "(none)"
    : `${config.recapModel.provider}/${config.recapModel.id}`;
}

export function registerPiRecap(
  pi: ExtensionAPI,
  dependencies: PiRecapDependencies = {}
): PiRecapRegistration {
  const version = dependencies.version ?? VERSION;
  let lastRecapEntryId: string | null = null;
  let lastRecapText: string | null = null;
  let pending: Promise<void> | null = null;
  let alive = false;
  let idleTimerHandle: object | null = null;
  let currentIdleDelaySeconds = 0;
  let autoRecapEnabled = false;
  let generation = 0;
  const backgroundTasks = new Set<Promise<void>>();
  const widgets = createRecapWidgetRenderer();
  const timers = dependencies.timers ?? DEFAULT_TIMERS;

  const inspect = (): PiRecapRuntimeState => ({
    alive,
    pending: pending !== null,
    lastRecapEntryId,
    lastRecapText,
    autoRecapEnabled,
    currentIdleDelaySeconds,
    idleTimerScheduled: idleTimerHandle !== null
  });

  const waitForBackgroundTasks = async (): Promise<void> => {
    await Promise.resolve();
    while (backgroundTasks.size > 0) {
      await Promise.all([...backgroundTasks]);
      await Promise.resolve();
    }
  };

  const registration: PiRecapRegistration = { inspect, waitForBackgroundTasks };

  if (!isVersionAtLeast(version, REQUIRED_PI_VERSION)) {
    pi.on("session_start", (_event, ctx) => {
      ctx.ui.notify(
        `pi-recap requires Pi >= ${REQUIRED_PI_VERSION} (found ${version}); recap is disabled.`,
        "error"
      );
    });
    return registration;
  }

  const modules = Promise.resolve((dependencies.moduleLoader ?? defaultModuleLoader)());
  const settingsSourceFactory =
    dependencies.settingsSourceFactory ??
    ((cwd: string, agentDir?: string): SettingsSource => SettingsManager.create(cwd, agentDir));

  const loadConfig = (ctx: Pick<ExtensionContext, "cwd">): RecapConfig =>
    loadRecapConfig(settingsSourceFactory(ctx.cwd, dependencies.agentDir));

  const saveConfig = (config: RecapConfig): void => {
    if (dependencies.agentDir === undefined) {
      saveRecapConfig(config);
    } else {
      saveRecapConfig(config, dependencies.agentDir);
    }
  };

  const persistConfig = (ctx: Pick<ExtensionContext, "ui">, config: RecapConfig): boolean => {
    try {
      saveConfig(config);
      return true;
    } catch (error) {
      ctx.ui.notify(`Recap: ${errorMessage(error)}`, "error");
      return false;
    }
  };

  const clearIdleTimer = (): void => {
    if (idleTimerHandle === null) return;
    timers.clearTimeout(idleTimerHandle);
    idleTimerHandle = null;
  };

  const trackBackgroundTask = (work: () => Promise<void>): void => {
    queueMicrotask(() => {
      const task = work();
      backgroundTasks.add(task);
      void task.finally(() => {
        backgroundTasks.delete(task);
      });
    });
  };

  const runRecap = async (ctx: ExtensionContext, trigger: RecapTrigger): Promise<void> => {
    if (!alive) return;

    const leafId = ctx.sessionManager.getLeafId();
    if (trigger === "auto" && leafId === lastRecapEntryId) return;
    if (pending !== null) return;

    const myGeneration = generation;
    let loadingShown = false;
    const task = (async (): Promise<void> => {
      const config = loadConfig(ctx);
      if (trigger === "auto" && !config.autoRecapEnabled) return;

      const runtimeModules = await modules;
      const preflight = await runtimeModules.preflightRecap(config, trigger, {
        registry: ctx.modelRegistry,
        notify: (message, type) => {
          ctx.ui.notify(message, type);
        },
        saveConfig
      });
      if (!preflight.ok) return;

      // Activity or a session change can invalidate the request while preflight is awaiting I/O.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!alive || myGeneration !== generation) return;
      if (ctx.sessionManager.getLeafId() !== leafId) return;

      const conversationText = buildRecentConversationText(
        ctx.sessionManager.getBranch(),
        config.recentMessageLimit
      );
      if (conversationText.trim().length === 0) {
        if (trigger === "manual") {
          ctx.ui.notify("Recap: nothing to recap yet", "info");
        }
        return;
      }

      widgets.render(ctx, { text: lastRecapText, loading: true });
      loadingShown = true;

      const rawText = await runtimeModules.generateRecapText(
        {
          conversationText,
          wordLimit: config.wordLimit,
          model: preflight.model,
          auth: preflight.auth,
          effectiveLevel: preflight.effectiveLevel
        },
        dependencies.completion === undefined ? undefined : { completion: dependencies.completion }
      );

      // Event handlers can invalidate this request while generation is awaiting the model.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!alive || myGeneration !== generation) return;
      if (ctx.sessionManager.getLeafId() !== leafId) return;

      const normalized = runtimeModules.normalizeRecapText(rawText);
      if (normalized.length === 0) {
        ctx.ui.notify("Recap: Recap Model returned an empty response.", "warning");
        return;
      }

      lastRecapText = runtimeModules.enforceWordLimit(normalized, config.wordLimit);
      lastRecapEntryId = leafId;
    })();

    pending = task;
    try {
      await task;
    } finally {
      if (pending === task) pending = null;
      // The awaited task and lifecycle events mutate these values outside lint's control flow.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (loadingShown && alive && myGeneration === generation) {
        widgets.render(ctx, { text: lastRecapText, loading: false });
      }
    }
  };

  const scheduleIdleRecap = (ctx: ExtensionContext): void => {
    clearIdleTimer();
    if (
      !alive ||
      !autoRecapEnabled ||
      !Number.isFinite(currentIdleDelaySeconds) ||
      currentIdleDelaySeconds <= 0
    ) {
      return;
    }

    idleTimerHandle = timers.setTimeout(() => {
      idleTimerHandle = null;
      trackBackgroundTask(async () => {
        if (!alive) return;

        if (!ctx.isIdle()) {
          widgets.render(ctx, { text: null, loading: false });
          scheduleIdleRecap(ctx);
          return;
        }

        try {
          await runRecap(ctx, "auto");
        } catch (error) {
          ctx.ui.notify(`Recap tick failed: ${errorMessage(error)}`, "warning");
        } finally {
          if (ctx.isIdle()) scheduleIdleRecap(ctx);
        }
      });
    }, currentIdleDelaySeconds * 1_000);
  };

  const applyTimerConfig = (ctx: ExtensionContext, config: RecapConfig): void => {
    autoRecapEnabled = config.autoRecapEnabled;
    currentIdleDelaySeconds = config.idleDelaySeconds;
    clearIdleTimer();
    if (autoRecapEnabled && ctx.isIdle()) scheduleIdleRecap(ctx);
  };

  const markActive = (ctx: ExtensionContext): void => {
    clearIdleTimer();
    widgets.render(ctx, { text: null, loading: false });
  };

  const runScheduledRecap = async (
    ctx: ExtensionContext,
    trigger: "startup" | "compaction"
  ): Promise<void> => {
    try {
      await runRecap(ctx, trigger);
    } catch (error) {
      ctx.ui.notify(`Recap failed: ${errorMessage(error)}`, "error");
    } finally {
      if (ctx.isIdle()) scheduleIdleRecap(ctx);
    }
  };

  pi.on("session_start", (event, ctx) => {
    if (!ctx.hasUI) return;

    generation++;
    alive = true;
    lastRecapEntryId = null;
    lastRecapText = null;
    pending = null;
    clearIdleTimer();
    widgets.reset();

    const config = loadConfig(ctx);
    autoRecapEnabled = config.autoRecapEnabled;
    currentIdleDelaySeconds = config.idleDelaySeconds;
    widgets.render(ctx, { text: null, loading: false });

    if (event.reason === "resume" || event.reason === "fork") {
      trackBackgroundTask(() => runScheduledRecap(ctx, "startup"));
    } else {
      scheduleIdleRecap(ctx);
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    generation++;
    alive = false;
    clearIdleTimer();
    lastRecapEntryId = null;
    lastRecapText = null;
    pending = null;
    widgets.reset();
    ctx.ui.setWidget("pi-recap", undefined);
  });

  pi.on("input", (_event, ctx) => {
    if (!alive) return;
    generation++;
    markActive(ctx);
  });

  pi.on("turn_start", (_event, ctx) => {
    if (!alive) return;
    generation++;
    markActive(ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    if (!alive) return;
    scheduleIdleRecap(ctx);
  });

  pi.on("session_compact", (_event, ctx) => {
    if (!alive) return;
    generation++;
    clearIdleTimer();
    trackBackgroundTask(() => runScheduledRecap(ctx, "compaction"));
  });

  const runManualRecap = async (ctx: ExtensionContext): Promise<void> => {
    clearIdleTimer();
    try {
      await runRecap(ctx, "manual");
    } catch (error) {
      ctx.ui.notify(`Recap failed: ${errorMessage(error)}`, "error");
    } finally {
      if (ctx.isIdle()) scheduleIdleRecap(ctx);
    }
  };

  const handleModelCommand = async (
    ctx: ExtensionContext,
    requestedModel: RecapConfig["recapModel"]
  ): Promise<void> => {
    const config = loadConfig(ctx);
    if (requestedModel === null) {
      if (!persistConfig(ctx, { ...config, recapModel: null })) return;
      ctx.ui.notify("Recap: Recap Model cleared.", "info");
      return;
    }

    await ctx.modelRegistry.refresh();
    const model = ctx.modelRegistry.find(requestedModel.provider, requestedModel.id);
    if (model === undefined) {
      if (!persistConfig(ctx, { ...config, recapModel: requestedModel })) return;
      ctx.ui.notify(
        `Recap: ${requestedModel.provider}/${requestedModel.id} is not currently available or authenticated; the Recap Model setting was saved.`,
        "warning"
      );
      return;
    }

    const runtimeModules = await modules;
    const effectiveLevel = runtimeModules.clampThinkingLevel(model, config.thinkingLevel);
    if (
      !persistConfig(ctx, {
        ...config,
        recapModel: requestedModel,
        thinkingLevel: effectiveLevel
      })
    ) {
      return;
    }

    if (effectiveLevel === config.thinkingLevel) {
      ctx.ui.notify(
        `Recap: Recap Model set to ${requestedModel.provider}/${requestedModel.id}.`,
        "info"
      );
    } else {
      ctx.ui.notify(
        `Recap: Recap Model set to ${requestedModel.provider}/${requestedModel.id}; Recap Thinking Level clamped to ${effectiveLevel}.`,
        "info"
      );
    }
  };

  const handleThinkingCommand = async (
    ctx: ExtensionContext,
    level: StoredThinkingLevel
  ): Promise<void> => {
    const config = loadConfig(ctx);
    if (config.recapModel === null) {
      if (!persistConfig(ctx, { ...config, thinkingLevel: level })) return;
      ctx.ui.notify(`Recap: Recap Thinking Level set to ${level}.`, "info");
      return;
    }

    await ctx.modelRegistry.refresh();
    const model = ctx.modelRegistry.find(config.recapModel.provider, config.recapModel.id);
    if (model === undefined) {
      if (!persistConfig(ctx, { ...config, thinkingLevel: level })) return;
      ctx.ui.notify(
        `Recap: ${config.recapModel.provider}/${config.recapModel.id} is not currently available; Recap Thinking Level ${level} will be clamped when the model is available.`,
        "warning"
      );
      return;
    }

    const runtimeModules = await modules;
    const effectiveLevel = runtimeModules.clampThinkingLevel(model, level);
    if (!persistConfig(ctx, { ...config, thinkingLevel: effectiveLevel })) return;

    if (effectiveLevel === level) {
      ctx.ui.notify(`Recap: Recap Thinking Level set to ${effectiveLevel}.`, "info");
    } else {
      ctx.ui.notify(
        `Recap: Recap Thinking Level set to ${effectiveLevel} (clamped from ${level} for ${config.recapModel.provider}/${config.recapModel.id}).`,
        "info"
      );
    }
  };

  pi.registerCommand("recap", {
    description:
      "Manage the session recap widget. Subcommands: settings, auto, model, thinking, delay, messages, words, config, or no args to refresh.",
    handler: async (args, ctx) => {
      try {
        const command = parseRecapCommand(args);
        switch (command.kind) {
          case "refresh":
            await runManualRecap(ctx);
            return;
          case "settings":
            if (!ctx.hasUI) {
              ctx.ui.notify(
                "Recap: interactive settings require TUI mode. Typed /recap subcommands remain available.",
                "warning"
              );
              return;
            }
            await (
              await modules
            ).openRecapSettingsMenu({
              ui: ctx.ui,
              registry: ctx.modelRegistry,
              loadConfig: () => loadConfig(ctx),
              saveConfig,
              onSaved: (config) => {
                applyTimerConfig(ctx, config);
              }
            });
            return;
          case "config": {
            const config = loadConfig(ctx);
            ctx.ui.notify(
              `Recap: model=${modelLabel(config)} thinking=${config.thinkingLevel} auto=${config.autoRecapEnabled ? "on" : "off"} idleDelay=${config.idleDelaySeconds}s recentMessages=${config.recentMessageLimit} maxWords=${config.wordLimit}`,
              "info"
            );
            return;
          }
          case "auto": {
            const config = loadConfig(ctx);
            const updated = { ...config, autoRecapEnabled: command.enabled };
            if (!persistConfig(ctx, updated)) return;
            autoRecapEnabled = command.enabled;
            if (command.enabled && ctx.isIdle()) {
              scheduleIdleRecap(ctx);
            } else {
              clearIdleTimer();
            }
            ctx.ui.notify(`Recap: Auto Recap ${command.enabled ? "enabled" : "disabled"}.`, "info");
            return;
          }
          case "model":
            await handleModelCommand(ctx, command.model);
            return;
          case "thinking":
            await handleThinkingCommand(ctx, command.level);
            return;
          case "delay": {
            const config = loadConfig(ctx);
            const updated = { ...config, idleDelaySeconds: command.seconds };
            if (!persistConfig(ctx, updated)) return;
            currentIdleDelaySeconds = command.seconds;
            clearIdleTimer();
            if (autoRecapEnabled && ctx.isIdle()) scheduleIdleRecap(ctx);
            ctx.ui.notify(`Recap: Idle Delay set to ${command.seconds}s.`, "info");
            return;
          }
          case "messages": {
            const config = loadConfig(ctx);
            if (!persistConfig(ctx, { ...config, recentMessageLimit: command.count })) return;
            ctx.ui.notify(`Recap: Recent Messages set to ${command.count}.`, "info");
            return;
          }
          case "words": {
            const config = loadConfig(ctx);
            if (!persistConfig(ctx, { ...config, wordLimit: command.count })) return;
            ctx.ui.notify(`Recap: Maximum Words set to ${command.count}.`, "info");
            return;
          }
          case "usage":
          case "unknown":
            ctx.ui.notify(command.message, "warning");
        }
      } catch (error) {
        ctx.ui.notify(`Recap: ${errorMessage(error)}`, "error");
      }
    }
  });

  return registration;
}

export default function piRecap(pi: ExtensionAPI): void {
  registerPiRecap(pi);
}
