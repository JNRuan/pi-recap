import { complete } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { Text, type TUI } from "@earendil-works/pi-tui";
import {
  type RecapConfig,
  DEFAULTS,
  loadSettingsPiRecap,
  parseRecapModel,
  resolveConfig,
  saveRecapSettings
} from "./config";
import { buildRecentConversationText } from "./conversation";

const RECAP_SYSTEM_PROMPT = `The user stepped away and is coming back. Write a brief "where did I leave off?" recap for a coding-agent session.

Start with the recent high-level task or current state: what the user is building, debugging, reviewing, or deciding. Then include the concrete next step if it is clear.

Focus on the most recent meaningful progress and useful continuity. Prefer task state and decisions over implementation details.

STRICT RULES:
- Exactly 1 to 3 short sentences, under 50 words total.
- One paragraph, plain prose: no bullets, headings, or markdown.
- Do NOT list files changed, commands run, tool calls, commits, or status reports unless essential to understanding the next step.
- Do not describe the conversation flow ("the user asked… then you answered…").
- If nothing concrete happened recently, say so briefly.
- Do not start with "Recap" — that prefix is added for you.`;

interface RecapWidgetState {
  text: string | null;
  loading: boolean;
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

// Widget-level animation state (module-scope, cleared on session_start)
let recapWidgetTui: TUI | null = null;
let recapWidgetText: Text | null = null;
let spinInterval: ReturnType<typeof setInterval> | null = null;
let spinFrame = 0;
let recapTheme: { fg: (style: string, text: string) => string } | null = null;

function spinLabel(): string {
  const spin = SPINNER[spinFrame];
  const label = "Recap: generating...";
  return recapTheme ? recapTheme.fg("dim", `${spin} ${label}`) : `${spin} ${label}`;
}

function startSpinner() {
  if (spinInterval) return;
  spinFrame = 0;
  spinInterval = setInterval(() => {
    spinFrame = (spinFrame + 1) % SPINNER.length;
    recapWidgetText?.setText(spinLabel());
    recapWidgetTui?.requestRender();
  }, SPIN_INTERVAL_MS);
}

function stopSpinner() {
  if (spinInterval) {
    clearInterval(spinInterval);
    spinInterval = null;
  }
}

function renderRecapWidget(ctx: { ui: ExtensionContext["ui"] }, state: RecapWidgetState) {
  if (state.text === null && !state.loading) {
    ctx.ui.setWidget("pi-recap", undefined);
    stopSpinner();
    recapWidgetTui = null;
    recapWidgetText = null;
    recapTheme = null;
    return;
  }

  ctx.ui.setWidget(
    "pi-recap",
    (tui, theme) => {
      recapWidgetTui = tui;
      recapTheme = theme as typeof recapTheme;

      if (state.loading) {
        const spin = SPINNER[spinFrame];
        recapWidgetText = new Text(theme.fg("dim", `${spin} Recap: generating...`), 1, 1);
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
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const RECAP_MODEL_UNSET_WARNING =
  "Recap: provider/model are not set. Run /recap model provider/model to enable recaps.";

function loadRecapConfig(
  ctx: Pick<ExtensionContext, "cwd">,
  overrides: Partial<RecapConfig> = {}
): RecapConfig {
  const sm = SettingsManager.create(ctx.cwd);
  const settings = loadSettingsPiRecap(sm);
  return resolveConfig(settings, overrides);
}

function hasConfiguredRecapModel(config: RecapConfig): boolean {
  return config.provider.length > 0 && config.model.length > 0;
}

interface RunRecapOptions {
  force: boolean;
  overrides: Partial<RecapConfig>;
}

async function runRecap(ctx: ExtensionContext, opts: RunRecapOptions) {
  if (!alive) return;

  const leafId = ctx.sessionManager.getLeafId();
  if (!opts.force && leafId === lastRecapEntryId) return;

  if (pending) return;

  const config = loadRecapConfig(ctx, opts.overrides);
  if (!hasConfiguredRecapModel(config)) {
    if (opts.force) {
      ctx.ui.notify(RECAP_MODEL_UNSET_WARNING, "warning");
    }
    return;
  }

  const myGen = generation;

  // Show loading immediately after guards
  renderRecapWidget(ctx, { text: lastRecapText, loading: true });

  pending = (async () => {
    const branch = ctx.sessionManager.getBranch();
    const conversationText = buildRecentConversationText(branch, config.recentMessageLimit);

    if (conversationText.trim().length === 0) {
      ctx.ui.notify("Nothing to recap yet", "info");
      return;
    }

    const model: Model<Api> | undefined = ctx.modelRegistry.find(config.provider, config.model);
    if (!model) {
      ctx.ui.notify(
        `Recap: model not found in registry — ${config.provider}/${config.model}`,
        "warning"
      );
      return;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      ctx.ui.notify(`Recap: ${auth.error}`, "warning");
      return;
    }
    if (!auth.apiKey) {
      ctx.ui.notify(`Recap: no API key for ${model.provider}/${model.id}`, "warning");
      return;
    }

    const response = await complete(
      model,
      {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: conversationText }],
            timestamp: Date.now()
          }
        ],
        systemPrompt: RECAP_SYSTEM_PROMPT
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        ...(model.reasoning ? { reasoningEffort: config.effort } : {})
      }
    );

    // `alive` may be set to false by `session_shutdown` while we awaited `complete()`.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!alive || myGen !== generation) return;
    if (ctx.sessionManager.getLeafId() !== leafId) return;

    let text = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();

    text = text.replace(/^Recap:\s*/i, "").trim();

    const words = text.split(/\s+/);
    if (words.length > config.wordLimit) {
      text = words.slice(0, config.wordLimit).join(" ") + "\u2026";
    }

    if (text.length === 0) {
      ctx.ui.notify("Recap model returned empty response", "warning");
      return;
    }

    lastRecapText = text;
    lastRecapEntryId = leafId;
  })();

  try {
    await pending;
  } finally {
    pending = null;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (alive && myGen === generation) {
      renderRecapWidget(ctx, { text: lastRecapText, loading: false });
    }
  }
}

// --- closure state (reset on every session_start) ---
let lastRecapEntryId: string | null = null;
let lastRecapText: string | null = null;
let pending: Promise<void> | null = null;
let alive = false;
let idleTimerHandle: ReturnType<typeof setTimeout> | null = null;
let currentIntervalMs = 0;
let generation = 0;

function clearIdleTimer() {
  if (!idleTimerHandle) return;
  clearTimeout(idleTimerHandle);
  idleTimerHandle = null;
}

function scheduleIdleRecap(ctx: ExtensionContext) {
  clearIdleTimer();
  if (!alive || !Number.isFinite(currentIntervalMs) || currentIntervalMs <= 0) return;

  idleTimerHandle = setTimeout(() => {
    idleTimerHandle = null;
    void tick(ctx);
  }, currentIntervalMs);
}

function markActive(ctx: ExtensionContext) {
  clearIdleTimer();
  renderRecapWidget(ctx, { text: null, loading: false });
}

async function tick(ctx: ExtensionContext) {
  if (!alive) return;

  if (!ctx.isIdle()) {
    markActive(ctx);
    scheduleIdleRecap(ctx);
    return;
  }

  try {
    await runRecap(ctx, { force: false, overrides: {} });
  } catch (err) {
    ctx.ui.notify(`Recap tick failed: ${errorMessage(err)}`, "warning");
  } finally {
    if (ctx.isIdle()) {
      scheduleIdleRecap(ctx);
    }
  }
}

export default function piRecap(pi: ExtensionAPI) {
  pi.registerFlag("recap-provider", {
    description: "Override recap provider",
    type: "string"
  });

  pi.registerFlag("recap-model", {
    description: "Override recap model",
    type: "string"
  });

  pi.registerFlag("recap-effort", {
    description: "Override recap reasoning effort (low, medium, high)",
    type: "string"
  });

  pi.registerFlag("recap-interval", {
    description: "Auto-refresh interval in ms (0 = disabled)",
    type: "string"
  });

  pi.on("session_start", (_e, ctx) => {
    if (!ctx.hasUI) return;

    generation++;
    alive = true;

    lastRecapEntryId = null;
    lastRecapText = null;
    pending = null;
    recapWidgetTui = null;
    recapWidgetText = null;
    stopSpinner();
    recapTheme = null;

    const config = loadRecapConfig(ctx);
    const hasRecapModel = hasConfiguredRecapModel(config);
    currentIntervalMs = config.intervalMs;

    if (!hasRecapModel) {
      ctx.ui.notify(RECAP_MODEL_UNSET_WARNING, "warning");
    }

    const shouldRunInitialRecap = hasRecapModel && (_e.reason === "resume" || _e.reason === "fork");

    if (shouldRunInitialRecap) {
      queueMicrotask(() => {
        void runRecap(ctx, { force: true, overrides: {} })
          .catch((err: unknown) => {
            ctx.ui.notify(`Recap failed: ${errorMessage(err)}`, "error");
          })
          .finally(() => {
            if (ctx.isIdle()) {
              scheduleIdleRecap(ctx);
            }
          });
      });
    } else {
      scheduleIdleRecap(ctx);
    }

    renderRecapWidget(ctx, { text: null, loading: false });
  });

  pi.on("session_shutdown", (_e, ctx) => {
    generation++;
    alive = false;
    clearIdleTimer();
    lastRecapText = null;
    stopSpinner();
    recapWidgetTui = null;
    recapWidgetText = null;
    recapTheme = null;
    ctx.ui.setWidget("pi-recap", undefined);
  });

  pi.on("input", (_event, ctx) => {
    if (!alive) return;
    generation++;
    markActive(ctx);
  });

  pi.on("turn_start", (_event, ctx) => {
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
    lastRecapEntryId = null;
    clearIdleTimer();
    queueMicrotask(() => {
      void runRecap(ctx, { force: true, overrides: {} })
        .catch((err: unknown) => {
          ctx.ui.notify(`Recap failed: ${errorMessage(err)}`, "error");
        })
        .finally(() => {
          if (ctx.isIdle()) {
            scheduleIdleRecap(ctx);
          }
        });
    });
  });

  pi.registerCommand("recap", {
    description:
      "Manage the session recap widget. Subcommands: on, off, model, messages, config, or no args to refresh.",
    // eslint-disable-next-line @typescript-eslint/require-await -- API contract requires Promise<void>
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      if (trimmed === "config") {
        const config = loadRecapConfig(ctx);
        const provider = config.provider || "(unset)";
        const model = config.model || "(unset)";
        const auto = config.intervalMs > 0 ? `on (${config.intervalMs}ms)` : "off";
        ctx.ui.notify(
          `Recap: auto=${auto} provider=${provider} model=${model} effort=${config.effort} wordLimit=${config.wordLimit} recentMessageLimit=${config.recentMessageLimit}`,
          "info"
        );
        return;
      }

      if (trimmed === "on") {
        const settings = loadSettingsPiRecap(SettingsManager.create(ctx.cwd));
        const stored = settings.intervalMs;
        const defaultInterval =
          typeof stored === "number" && stored > 0 ? stored : DEFAULTS.intervalMs;
        try {
          saveRecapSettings({ intervalMs: defaultInterval });
        } catch (err) {
          ctx.ui.notify(`Recap: ${errorMessage(err)}`, "error");
          return;
        }
        currentIntervalMs = defaultInterval;
        scheduleIdleRecap(ctx);
        ctx.ui.notify(`Recap: auto-refresh enabled (${defaultInterval}ms)`, "info");
        return;
      }

      if (trimmed === "off") {
        try {
          saveRecapSettings({ intervalMs: 0 });
        } catch (err) {
          ctx.ui.notify(`Recap: ${errorMessage(err)}`, "error");
          return;
        }
        currentIntervalMs = 0;
        clearIdleTimer();
        ctx.ui.notify("Recap: auto-refresh disabled", "info");
        return;
      }

      if (trimmed.startsWith("model")) {
        if (trimmed === "model") {
          ctx.ui.notify("Usage: /recap model provider/model", "warning");
          return;
        }
        const modelArg = trimmed.slice("model".length).trim();
        const parsed = parseRecapModel(modelArg);
        if (!parsed) {
          ctx.ui.notify("Usage: /recap model provider/model", "warning");
          return;
        }
        try {
          saveRecapSettings({ provider: parsed.provider, model: parsed.model });
        } catch (err) {
          ctx.ui.notify(`Recap: ${errorMessage(err)}`, "error");
          return;
        }
        scheduleIdleRecap(ctx);
        ctx.ui.notify(`Recap: model set to ${parsed.provider}/${parsed.model}`, "info");
        return;
      }

      if (trimmed.startsWith("messages") || trimmed.startsWith("recent")) {
        const subcommand = trimmed.startsWith("messages") ? "messages" : "recent";
        const limitArg = trimmed.slice(subcommand.length).trim();
        const recentMessageLimit = Number(limitArg);
        if (!Number.isInteger(recentMessageLimit) || recentMessageLimit <= 0) {
          ctx.ui.notify(`Usage: /recap ${subcommand} 20`, "warning");
          return;
        }
        try {
          saveRecapSettings({ recentMessageLimit });
        } catch (err) {
          ctx.ui.notify(`Recap: ${errorMessage(err)}`, "error");
          return;
        }
        ctx.ui.notify(`Recap: recent message limit set to ${recentMessageLimit}`, "info");
        return;
      }

      // No subcommand — just force-refresh the recap
      clearIdleTimer();
      void runRecap(ctx, { force: true, overrides: {} })
        .catch((err: unknown) => {
          ctx.ui.notify(`Recap failed: ${errorMessage(err)}`, "error");
        })
        .finally(() => {
          if (ctx.isIdle()) {
            scheduleIdleRecap(ctx);
          }
        });
    }
  });
}
