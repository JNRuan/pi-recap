import { complete } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  type RecapConfig,
  loadSettingsPiRecap,
  parseRecapModel,
  resolveConfig,
  saveRecapSettings
} from "./config";
import { buildRecentConversationText } from "./conversation";

const RECAP_SYSTEM_PROMPT = `Write a recap of the conversation in 50 words or fewer.
Lean toward what just happened — the last few exchanges should dominate.
Avoid restating early background unless it is directly relevant right now.
One paragraph, no bullets, no markdown headings.
Do not start with the word "Recap" — that prefix will be added for you.`;

interface RecapWidgetState {
  text: string | null;
  loading: boolean;
}

function renderRecapWidget(ctx: { ui: ExtensionContext["ui"] }, state: RecapWidgetState) {
  if (state.text === null && !state.loading) {
    ctx.ui.setWidget("pi-recap", undefined);
    return;
  }

  let content: string;
  if (state.text === null && state.loading) {
    content = "Generating recap\u2026";
  } else if (state.text !== null && state.loading) {
    content = state.text + "  Refreshing\u2026";
  } else {
    content = state.text ?? "";
  }

  const label = "Recap: ";
  ctx.ui.setWidget("pi-recap", (_tui, theme) => new Text(theme.fg("dim", label + content), 1, 1), {
    placement: "aboveEditor"
  });
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

    const model = ctx.model as Model<Api> | undefined;
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
      ctx.ui.notify("Recap: no API key for active model", "warning");
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
  if (!ctx.isIdle()) return;

  try {
    await runRecap(ctx, { force: false, overrides: {} });
  } catch (err) {
    ctx.ui.notify(`Recap tick failed: ${errorMessage(err)}`, "warning");
  }
}

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
      "Refresh the session recap shown above the editor. Pass provider/model to override, or config to show settings.",
    // eslint-disable-next-line @typescript-eslint/require-await -- API contract requires Promise<void>
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      if (trimmed === "config") {
        const sm = SettingsManager.create(ctx.cwd);
        const settings = loadSettingsPiRecap(sm);
        const config = resolveConfig(ctx, settings, {});
        const provider = config.provider ?? ctx.model?.provider ?? "(none)";
        const model = config.model ?? ctx.model?.id ?? "(none)";
        ctx.ui.notify(
          `Recap: provider=${provider} model=${model} effort=${config.effort} interval=${config.intervalMs}ms wordLimit=${config.wordLimit}`,
          "info"
        );
        return;
      }

      let overrides: Partial<RecapConfig> = {};
      if (trimmed) {
        const parsed = parseRecapModel(trimmed);
        if (!parsed) {
          ctx.ui.notify("Usage: /recap provider/model | /recap config | /recap", "warning");
          return;
        }
        saveRecapSettings(parsed.provider, parsed.model);
        overrides = parsed;
      }

      void runRecap(ctx, { force: true, overrides }).catch((err: unknown) => {
        ctx.ui.notify(`Recap failed: ${errorMessage(err)}`, "error");
      });
      resetInterval(ctx);
    }
  });
}
