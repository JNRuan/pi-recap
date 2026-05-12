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

const RECAP_SYSTEM_PROMPT = `Focus on what was accomplished — changes made, files edited, decisions reached, and issues resolved.
Prefer concrete actions over discussion. If a problem was investigated but not fixed, note that.
Keep it to 100 words or fewer.
One paragraph, no bullets, no markdown headings.
Do not start with the word "Recap" — that prefix will be added for you.`;

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

interface RunRecapOptions {
  force: boolean;
  overrides: Partial<RecapConfig>;
}

async function runRecap(ctx: ExtensionContext, opts: RunRecapOptions) {
  if (!alive) return;

  const leafId = ctx.sessionManager.getLeafId();
  if (!opts.force && leafId === lastRecapEntryId) return;

  if (pending) return;

  // Show loading immediately after guards
  renderRecapWidget(ctx, { text: lastRecapText, loading: true });

  pending = (async () => {
    const branch = ctx.sessionManager.getBranch();
    const conversationText = buildRecentConversationText(branch);

    if (conversationText.trim().length === 0) {
      ctx.ui.notify("Nothing to recap yet", "info");
      return;
    }

    const sm = SettingsManager.create(ctx.cwd);
    const settings = loadSettingsPiRecap(sm);
    const config = resolveConfig(ctx, settings, opts.overrides);

    // Use explicit override if configured, otherwise fall back to the active model
    let model: Model<Api> | undefined;
    if (config.provider && config.model) {
      model = ctx.modelRegistry.find(config.provider, config.model);
      if (!model) {
        ctx.ui.notify(
          `Recap: model not found in registry — ${config.provider}/${config.model}`,
          "warning"
        );
        return;
      }
    } else {
      model = ctx.model as Model<Api> | undefined;
    }

    if (!model) {
      ctx.ui.notify("No active model to generate recap", "warning");
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
    if (!alive) return;

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
    if (alive) {
      renderRecapWidget(ctx, { text: lastRecapText, loading: false });
    }
  }
}

// --- closure state (reset on every session_start) ---
let lastRecapEntryId: string | null = null;
let lastRecapText: string | null = null;
let pending: Promise<void> | null = null;
let alive = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let currentIntervalMs = 0;

function startInterval(ctx: ExtensionContext) {
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }

  intervalHandle = setInterval(() => {
    void tick(ctx);
  }, currentIntervalMs);
}

async function tick(ctx: ExtensionContext) {
  if (!alive) return;

  if (!ctx.isIdle()) {
    renderRecapWidget(ctx, { text: null, loading: false });
    return;
  }

  try {
    await runRecap(ctx, { force: false, overrides: {} });
  } catch (err) {
    ctx.ui.notify(`Recap tick failed: ${errorMessage(err)}`, "warning");
  }
}

// Retained for future /recap flag support.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function resetInterval(ctx: ExtensionContext) {
  if (currentIntervalMs <= 0) return;
  startInterval(ctx);
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

    alive = true;

    lastRecapEntryId = null;
    lastRecapText = null;
    pending = null;
    recapWidgetTui = null;
    recapWidgetText = null;
    stopSpinner();
    recapTheme = null;

    const sm = SettingsManager.create(ctx.cwd);
    const settings = loadSettingsPiRecap(sm);
    const config = resolveConfig(ctx, settings, {});
    currentIntervalMs = config.intervalMs;

    if (currentIntervalMs > 0) {
      startInterval(ctx);
    }

    if (_e.reason === "resume" || _e.reason === "fork") {
      queueMicrotask(() => {
        void runRecap(ctx, { force: true, overrides: {} }).catch((err: unknown) => {
          ctx.ui.notify(`Recap failed: ${errorMessage(err)}`, "error");
        });
      });
    }

    renderRecapWidget(ctx, { text: null, loading: false });
  });

  pi.on("session_shutdown", (_e, ctx) => {
    alive = false;
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    lastRecapText = null;
    stopSpinner();
    recapWidgetTui = null;
    recapWidgetText = null;
    recapTheme = null;
    ctx.ui.setWidget("pi-recap", undefined);
  });

  pi.on("session_compact", (_event, ctx) => {
    if (!alive) return;
    lastRecapEntryId = null;
    queueMicrotask(() => {
      void runRecap(ctx, { force: true, overrides: {} }).catch((err: unknown) => {
        ctx.ui.notify(`Recap failed: ${errorMessage(err)}`, "error");
      });
    });
  });

  pi.registerCommand("recap", {
    description:
      "Manage the session recap widget. Subcommands: on, off, model, config, or no args to refresh.",
    // eslint-disable-next-line @typescript-eslint/require-await -- API contract requires Promise<void>
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      if (trimmed === "config") {
        const sm = SettingsManager.create(ctx.cwd);
        const settings = loadSettingsPiRecap(sm);
        const config = resolveConfig(ctx, settings, {});
        const provider = config.provider ?? ctx.model?.provider ?? "(none)";
        const model = config.model ?? ctx.model?.id ?? "(none)";
        const auto = config.intervalMs > 0 ? `on (${config.intervalMs}ms)` : "off";
        ctx.ui.notify(
          `Recap: auto=${auto} provider=${provider} model=${model} effort=${config.effort} wordLimit=${config.wordLimit}`,
          "info"
        );
        return;
      }

      if (trimmed === "on") {
        const sm = SettingsManager.create(ctx.cwd);
        const settings = loadSettingsPiRecap(sm);
        const defaultInterval = settings.intervalMs ?? DEFAULTS.intervalMs;
        saveRecapSettings({ intervalMs: defaultInterval });
        currentIntervalMs = defaultInterval;
        startInterval(ctx);
        ctx.ui.notify(`Recap: auto-refresh enabled (${defaultInterval}ms)`, "info");
        return;
      }

      if (trimmed === "off") {
        saveRecapSettings({ intervalMs: 0 });
        currentIntervalMs = 0;
        if (intervalHandle) {
          clearInterval(intervalHandle);
          intervalHandle = null;
        }
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
        saveRecapSettings({ provider: parsed.provider, model: parsed.model });
        ctx.ui.notify(`Recap: model set to ${parsed.provider}/${parsed.model}`, "info");
        return;
      }

      // No subcommand — just force-refresh the recap
      void runRecap(ctx, { force: true, overrides: {} }).catch((err: unknown) => {
        ctx.ui.notify(`Recap failed: ${errorMessage(err)}`, "error");
      });
    }
  });
}
