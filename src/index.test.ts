import { clampThinkingLevel, type Api, type Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "vitest";
import { buildNormalizedPiRecap, loadRecapConfig, type RecapConfig } from "./settings/config";
import {
  enforceWordLimit,
  generateRecapText,
  normalizeRecapText,
  preflightRecap,
  type SimpleCompletionFn
} from "./recap/generate";
import {
  registerPiRecap,
  type PiRecapRegistration,
  type RecapRuntimeModules,
  type RecapTimerFacade
} from "./index";
import type { RecapSettingsMenuDeps } from "./settings/menu";
import {
  DEFAULT_RECAP_CONFIG as DEFAULT_CONFIG,
  FakeRegistry,
  makeModel,
  makeResponse,
  type Notice
} from "./testing/support";

interface WidgetCall {
  cleared: boolean;
  renderedText: string;
  placement: string | undefined;
}

interface SessionEntry {
  type: string;
  message?: {
    role: string;
    content: { type: string; text: string }[];
  };
  summary?: string;
}

interface HarnessState {
  hasUI: boolean;
  idle: boolean;
  leafId: string | null;
  entries: SessionEntry[];
}

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;

interface FakeCommand {
  description?: string;
  handler(args: string, ctx: ExtensionCommandContext): Promise<void>;
}

class FakePi {
  private readonly handlers = new Map<string, EventHandler[]>();
  readonly commands = new Map<string, FakeCommand>();

  on(event: string, handler: unknown): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler as EventHandler);
    this.handlers.set(event, existing);
  }

  registerCommand(name: string, command: FakeCommand): void {
    this.commands.set(name, command);
  }

  async emit(event: string, payload: unknown, ctx: ExtensionContext): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) {
      await handler(payload, ctx);
    }
  }

  eventNames(): string[] {
    return [...this.handlers.keys()];
  }
}

class FakeUI {
  readonly notices: Notice[] = [];
  readonly widgets: WidgetCall[] = [];
  renderRequests = 0;

  notify(message: string, type: "info" | "warning" | "error" = "info"): void {
    this.notices.push({ message, type });
  }

  setWidget(_key: string, content: unknown, options?: { placement?: string }): void {
    if (typeof content !== "function") {
      this.widgets.push({ cleared: true, renderedText: "", placement: options?.placement });
      return;
    }

    const factory = content as (tui: TUI, theme: Theme) => Component;
    const tui = {
      requestRender: () => {
        this.renderRequests++;
      }
    } as unknown as TUI;
    const theme = {
      fg: (_color: string, text: string) => text
    } as unknown as Theme;
    const component = factory(tui, theme);
    this.widgets.push({
      cleared: false,
      renderedText: component.render(240).join("\n"),
      placement: options?.placement
    });
  }
}

interface FakeTimerEntry {
  due: number;
  callback: () => void;
}

class FakeTimers implements RecapTimerFacade {
  private now = 0;
  private readonly entries = new Map<object, FakeTimerEntry>();

  setTimeout(callback: () => void, delayMs: number): object {
    const handle = {};
    this.entries.set(handle, { due: this.now + delayMs, callback });
    return handle;
  }

  clearTimeout(handle: object): void {
    this.entries.delete(handle);
  }

  advance(milliseconds: number): void {
    const target = this.now + milliseconds;
    for (;;) {
      const next = [...this.entries.entries()]
        .filter(([, entry]) => entry.due <= target)
        .sort((left, right) => left[1].due - right[1].due)
        .at(0);
      if (next === undefined) break;

      const [handle, entry] = next;
      this.entries.delete(handle);
      this.now = entry.due;
      entry.callback();
    }
    this.now = target;
  }

  count(): number {
    return this.entries.size;
  }

  nextDelay(): number | null {
    const due = Math.min(...[...this.entries.values()].map((entry) => entry.due));
    return Number.isFinite(due) ? due - this.now : null;
  }
}

function messageEntries(text = "Continue the current task"): SessionEntry[] {
  return [
    {
      type: "message",
      message: { role: "user", content: [{ type: "text", text }] }
    }
  ];
}

interface HarnessOptions {
  config?: RecapConfig;
  models?: readonly Model<Api>[];
  entries?: SessionEntry[];
  leafId?: string | null;
  hasUI?: boolean;
  idle?: boolean;
  refreshTimeoutMs?: number;
}

interface DeferredCompletion {
  started: Promise<void>;
  resolve(text: string): void;
}

type QueuedCompletion = { kind: "response"; text: string } | { kind: "failure"; error: Error };

interface IndexHarness {
  pi: FakePi;
  ui: FakeUI;
  timers: FakeTimers;
  registry: FakeRegistry;
  state: HarnessState;
  runtime: PiRecapRegistration;
  completionCount(): number;
  moduleLoadCount(): number;
  menuOpenCount(): number;
  queueResponse(text: string): void;
  queueFailure(message: string): void;
  deferNextCompletion(): DeferredCompletion;
  setMenuBehavior(behavior: ((deps: RecapSettingsMenuDeps) => void) | null): void;
  setAgentDirMode(mode: number): void;
  start(reason?: "startup" | "reload" | "new" | "resume" | "fork"): Promise<void>;
  emit(event: string): Promise<void>;
  emitWithoutWaiting(event: string): Promise<void>;
  command(args: string): Promise<void>;
  readConfig(): RecapConfig;
}

const temporaryDirectories: string[] = [];

function createHarness(options: HarnessOptions = {}): IndexHarness {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-recap-index-"));
  temporaryDirectories.push(agentDir);
  const initialConfig = options.config ?? DEFAULT_CONFIG;
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify({ theme: "dark", piRecap: buildNormalizedPiRecap(initialConfig) }, null, 2)}\n`,
    "utf8"
  );

  const pi = new FakePi();
  const ui = new FakeUI();
  const timers = new FakeTimers();
  const registry = new FakeRegistry(options.models ?? []);
  const state: HarnessState = {
    hasUI: options.hasUI ?? true,
    idle: options.idle ?? true,
    leafId: options.leafId === undefined ? "leaf-1" : options.leafId,
    entries: options.entries ?? messageEntries()
  };
  const completionQueue: QueuedCompletion[] = [];
  const deferredCompletions: {
    markStarted(): void;
    response: Promise<ReturnType<typeof makeResponse>>;
  }[] = [];
  let completions = 0;
  let moduleLoads = 0;
  let menuOpens = 0;
  let menuBehavior: ((deps: RecapSettingsMenuDeps) => void) | null = null;

  const completion: SimpleCompletionFn = () => {
    completions++;
    const deferred = deferredCompletions.shift();
    if (deferred !== undefined) {
      deferred.markStarted();
      return deferred.response;
    }
    const queued = completionQueue.shift();
    if (queued?.kind === "failure") return Promise.reject(queued.error);
    return Promise.resolve(makeResponse(queued?.text ?? "Generated recap."));
  };
  const runtimeModules: RecapRuntimeModules = {
    clampThinkingLevel,
    preflightRecap,
    generateRecapText,
    normalizeRecapText,
    enforceWordLimit,
    openRecapSettingsMenu: (deps) => {
      menuOpens++;
      menuBehavior?.(deps);
      return Promise.resolve();
    }
  };

  const context = {
    get hasUI() {
      return state.hasUI;
    },
    mode: "tui",
    cwd: "/tmp/pi-recap-index-cwd",
    ui,
    sessionManager: {
      getLeafId: () => state.leafId,
      getBranch: () => state.entries
    },
    modelRegistry: registry,
    isIdle: () => state.idle
  } as unknown as ExtensionCommandContext;

  const runtime = registerPiRecap(pi as unknown as ExtensionAPI, {
    moduleLoader: () => {
      moduleLoads++;
      return runtimeModules;
    },
    settingsSourceFactory: () => ({
      getGlobalSettings: (): unknown =>
        JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))
    }),
    agentDir,
    timers,
    completion,
    refreshTimeoutMs: options.refreshTimeoutMs
  });

  const command = async (args: string): Promise<void> => {
    const recap = pi.commands.get("recap");
    assert.ok(recap, "recap command should be registered");
    await recap.handler(args, context);
  };

  return {
    pi,
    ui,
    timers,
    registry,
    state,
    runtime,
    completionCount: () => completions,
    moduleLoadCount: () => moduleLoads,
    menuOpenCount: () => menuOpens,
    queueResponse: (text) => {
      completionQueue.push({ kind: "response", text });
    },
    queueFailure: (message) => {
      completionQueue.push({ kind: "failure", error: new Error(message) });
    },
    deferNextCompletion: () => {
      let markStarted = (): void => undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let resolveResponse: (response: ReturnType<typeof makeResponse>) => void = () => undefined;
      const response = new Promise<ReturnType<typeof makeResponse>>((resolve) => {
        resolveResponse = resolve;
      });
      deferredCompletions.push({ markStarted, response });
      return {
        started,
        resolve: (text) => {
          resolveResponse(makeResponse(text));
        }
      };
    },
    setMenuBehavior: (behavior) => {
      menuBehavior = behavior;
    },
    setAgentDirMode: (mode) => {
      chmodSync(agentDir, mode);
    },
    start: async (reason = "new") => {
      await pi.emit("session_start", { type: "session_start", reason }, context);
      await runtime.waitForBackgroundTasks();
    },
    emit: async (event) => {
      await pi.emit(event, { type: event }, context);
      await runtime.waitForBackgroundTasks();
    },
    emitWithoutWaiting: async (event) => {
      await pi.emit(event, { type: event }, context);
    },
    command,
    readConfig: () =>
      loadRecapConfig({
        getGlobalSettings: (): unknown =>
          JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))
      })
  };
}

function clearRecordedUI(harness: IndexHarness): void {
  harness.ui.notices.length = 0;
}

function latestNotice(harness: IndexHarness): Notice {
  const notice = harness.ui.notices.at(-1);
  assert.ok(notice, "expected a UI notification");
  return notice;
}

function createTypedSettingsHarness(): { harness: IndexHarness; model: Model<Api> } {
  const model = makeModel({ provider: "limited" }, ["off", "low", "medium"]);
  const harness = createHarness({
    config: {
      ...DEFAULT_CONFIG,
      recapModel: { provider: model.provider, id: model.id },
      autoRecapEnabled: false
    },
    models: [model]
  });
  return { harness, model };
}

describe("pi recap extension", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories) {
      chmodSync(directory, 0o700);
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  test("keeps automatic recaps silent when no model is configured", async () => {
    const harness = createHarness({
      config: { ...DEFAULT_CONFIG, idleDelaySeconds: 1 },
      entries: messageEntries(),
      leafId: "null-model-leaf"
    });
    await harness.start();
    const widgetCount = harness.ui.widgets.length;
    clearRecordedUI(harness);
    await harness.command("");
    assert.deepEqual(harness.ui.notices, [
      {
        message:
          "Recap: no Recap Model configured. Run /recap settings or /recap model provider/model.",
        type: "warning"
      }
    ]);
    assert.equal(harness.ui.widgets.length, widgetCount);
    assert.equal(harness.completionCount(), 0);

    clearRecordedUI(harness);
    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, []);
    assert.equal(harness.completionCount(), 0);
  });

  test("handles an empty conversation without generation", async () => {
    const model = makeModel();
    const harness = createHarness({
      config: { ...DEFAULT_CONFIG, recapModel: { provider: model.provider, id: model.id } },
      models: [model],
      entries: [],
      leafId: "empty-leaf"
    });
    await harness.start();
    const widgetCount = harness.ui.widgets.length;
    clearRecordedUI(harness);
    await harness.command("");
    assert.deepEqual(harness.ui.notices, [
      { message: "Recap: nothing to recap yet", type: "info" }
    ]);
    assert.equal(harness.ui.widgets.length, widgetCount);
    assert.equal(harness.completionCount(), 0);

    clearRecordedUI(harness);
    harness.timers.advance(DEFAULT_CONFIG.idleDelaySeconds * 1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, []);
  });

  test("generates recaps and preserves the last valid widget output", async () => {
    const model = makeModel();
    const harness = createHarness({
      config: {
        ...DEFAULT_CONFIG,
        recapModel: { provider: model.provider, id: model.id },
        idleDelaySeconds: 2,
        wordLimit: 5
      },
      models: [model],
      leafId: "generation-leaf"
    });
    await harness.start();
    harness.queueResponse("Stable previous recap.");
    await harness.command("");
    assert.equal(harness.runtime.inspect().lastRecapText, "Stable previous recap.");
    assert.equal(harness.runtime.inspect().lastRecapEntryId, "generation-leaf");
    const successfulWidget = harness.ui.widgets.at(-1);
    assert.ok(successfulWidget);
    assert.ok(successfulWidget.renderedText.includes("Recap: Stable previous recap."));
    assert.equal(successfulWidget.placement, "aboveEditor");

    harness.registry.models = [];
    clearRecordedUI(harness);
    const widgetsBeforeFailedGate = harness.ui.widgets.length;
    await harness.command("");
    assert.equal(harness.runtime.inspect().lastRecapText, "Stable previous recap.");
    assert.equal(harness.runtime.inspect().lastRecapEntryId, "generation-leaf");
    assert.equal(harness.ui.widgets.length, widgetsBeforeFailedGate);
    assert.equal(latestNotice(harness).type, "warning");

    harness.registry.models = [model];
    clearRecordedUI(harness);
    harness.queueResponse(" Recap:   ");
    await harness.command("");
    assert.equal(harness.runtime.inspect().lastRecapText, "Stable previous recap.");
    assert.equal(latestNotice(harness).message, "Recap: Recap Model returned an empty response.");
    assert.ok(harness.ui.widgets.at(-1)?.renderedText.includes("Stable previous recap."));

    clearRecordedUI(harness);
    harness.queueResponse("Recap: First short sentence. extra words keep going forever here");
    await harness.command("");
    assert.equal(harness.runtime.inspect().lastRecapText, "First short sentence.…");
    assert.ok(harness.ui.widgets.at(-1)?.renderedText.includes("Recap: First short sentence.…"));
  });

  test("applies automatic recap and delay commands", async () => {
    const model = makeModel();
    const harness = createHarness({
      config: {
        ...DEFAULT_CONFIG,
        recapModel: { provider: model.provider, id: model.id },
        idleDelaySeconds: 2
      },
      models: [model]
    });
    await harness.start();

    await harness.command("auto off");
    assert.equal(harness.timers.count(), 0);
    assert.equal(harness.readConfig().autoRecapEnabled, false);
    assert.equal(harness.readConfig().idleDelaySeconds, 2);
    harness.queueResponse("Manual refresh while disabled.");
    await harness.command("");
    assert.equal(harness.completionCount(), 1);
    assert.equal(harness.timers.count(), 0);

    await harness.command("auto on");
    assert.equal(harness.readConfig().autoRecapEnabled, true);
    assert.equal(harness.readConfig().idleDelaySeconds, 2);
    assert.equal(harness.timers.nextDelay(), 2_000);
    await harness.command("delay 5");
    assert.equal(harness.readConfig().autoRecapEnabled, true);
    assert.equal(harness.readConfig().idleDelaySeconds, 5);
    assert.equal(harness.runtime.inspect().autoRecapEnabled, true);
    assert.equal(harness.runtime.inspect().currentIdleDelaySeconds, 5);
    assert.equal(harness.timers.nextDelay(), 5_000);
  });

  test("generates after uninterrupted inactivity", async () => {
    const model = makeModel();
    const harness = createHarness({
      config: {
        ...DEFAULT_CONFIG,
        recapModel: { provider: model.provider, id: model.id },
        idleDelaySeconds: 5
      },
      models: [model],
      leafId: "timer-leaf"
    });
    await harness.start();
    harness.queueResponse("Initial recap.");
    await harness.command("");

    const beforeDedup = harness.completionCount();
    harness.timers.advance(5_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.equal(harness.completionCount(), beforeDedup);

    harness.state.leafId = "activity-leaf";
    harness.timers.advance(4_000);
    await harness.emit("input");
    assert.equal(harness.timers.count(), 0);
    await harness.emit("agent_end");
    assert.equal(harness.timers.nextDelay(), 5_000);
    const beforeActivityTick = harness.completionCount();
    harness.timers.advance(4_999);
    await harness.runtime.waitForBackgroundTasks();
    assert.equal(harness.completionCount(), beforeActivityTick);
    harness.queueResponse("Generated after uninterrupted inactivity.");
    harness.timers.advance(1);
    await harness.runtime.waitForBackgroundTasks();
    assert.equal(harness.completionCount(), beforeActivityTick + 1);
    assert.equal(harness.timers.nextDelay(), 5_000);
    await harness.emit("turn_start");
    assert.equal(harness.timers.count(), 0);
  });

  test("deduplicates automatic preflight warnings until recovery", async () => {
    const model = makeModel();
    const harness = createHarness({
      config: {
        ...DEFAULT_CONFIG,
        recapModel: { provider: model.provider, id: model.id },
        idleDelaySeconds: 1
      },
      models: [],
      leafId: "auto-warning-leaf"
    });
    await harness.start();
    clearRecordedUI(harness);

    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, [
      { message: "Recap: test/model is not currently available.", type: "warning" }
    ]);
    assert.equal(harness.registry.refreshCount, 1);

    clearRecordedUI(harness);
    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, []);
    assert.equal(harness.registry.refreshCount, 2);

    await harness.command("");
    await harness.command("");
    assert.deepEqual(harness.ui.notices, [
      { message: "Recap: test/model is not currently available.", type: "warning" },
      { message: "Recap: test/model is not currently available.", type: "warning" }
    ]);
    assert.equal(harness.registry.refreshCount, 4);

    clearRecordedUI(harness);
    harness.registry.models = [model];
    harness.registry.auth = { ok: false, error: "authentication failed" };
    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, [
      { message: "Recap: authentication failed", type: "warning" }
    ]);
    assert.equal(harness.registry.refreshCount, 5);

    clearRecordedUI(harness);
    harness.registry.auth = { ok: true, apiKey: "test-key" };
    harness.queueResponse("Recovered automatic recap.");
    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, []);
    assert.equal(harness.completionCount(), 1);

    harness.state.leafId = "auto-warning-leaf-2";
    harness.registry.auth = { ok: false, error: "authentication failed" };
    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, [
      { message: "Recap: authentication failed", type: "warning" }
    ]);
  });

  test("deduplicates empty automatic response warnings and keeps manual failures visible", async () => {
    const model = makeModel();
    const harness = createHarness({
      config: {
        ...DEFAULT_CONFIG,
        recapModel: { provider: model.provider, id: model.id },
        idleDelaySeconds: 1
      },
      models: [model],
      leafId: "auto-empty-leaf"
    });
    await harness.start();
    clearRecordedUI(harness);

    harness.queueResponse(" Recap: ");
    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, [
      {
        message: "Recap: Recap Model returned an empty response.",
        type: "warning"
      }
    ]);
    assert.equal(harness.runtime.inspect().lastRecapText, null);
    assert.equal(harness.completionCount(), 1);

    clearRecordedUI(harness);
    harness.queueResponse(" Recap: ");
    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, []);

    harness.queueResponse(" Recap: ");
    harness.queueResponse(" Recap: ");
    await harness.command("");
    await harness.command("");
    assert.deepEqual(harness.ui.notices, [
      {
        message: "Recap: Recap Model returned an empty response.",
        type: "warning"
      },
      {
        message: "Recap: Recap Model returned an empty response.",
        type: "warning"
      }
    ]);
    assert.equal(harness.completionCount(), 4);
  });

  test("deduplicates automatic exceptions until they change or recover", async () => {
    const model = makeModel();
    const harness = createHarness({
      config: {
        ...DEFAULT_CONFIG,
        recapModel: { provider: model.provider, id: model.id },
        idleDelaySeconds: 1
      },
      models: [model],
      leafId: "auto-error-leaf"
    });
    await harness.start();
    clearRecordedUI(harness);

    harness.queueFailure("provider offline");
    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, [
      { message: "Recap tick failed: provider offline", type: "warning" }
    ]);
    assert.equal(harness.completionCount(), 1);

    clearRecordedUI(harness);
    harness.queueFailure("provider offline");
    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, []);
    assert.equal(harness.completionCount(), 2);

    harness.queueFailure("request timed out");
    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, [
      { message: "Recap tick failed: request timed out", type: "warning" }
    ]);
    assert.equal(harness.completionCount(), 3);

    clearRecordedUI(harness);
    harness.queueResponse("Recovered recap.");
    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, []);
    assert.equal(harness.completionCount(), 4);

    harness.state.leafId = "auto-error-leaf-2";
    harness.queueFailure("provider offline");
    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.deepEqual(harness.ui.notices, [
      { message: "Recap tick failed: provider offline", type: "warning" }
    ]);
    assert.equal(harness.completionCount(), 5);
  });

  test("persists model and thinking commands", async () => {
    const { harness, model } = createTypedSettingsHarness();
    await harness.start();
    await harness.command("thinking max");
    assert.equal(harness.readConfig().thinkingLevel, "medium");
    assert.ok(latestNotice(harness).message.includes("clamped from max"));

    harness.registry.models = [];
    clearRecordedUI(harness);
    await harness.command("thinking high");
    assert.equal(harness.readConfig().thinkingLevel, "high");
    assert.deepEqual(latestNotice(harness), {
      message:
        "Recap: limited/model is not currently available; Recap Thinking Level high will be clamped when the model is available.",
      type: "warning"
    });

    harness.registry.models = [model];
    clearRecordedUI(harness);
    await harness.command("model limited/model");
    assert.equal(harness.readConfig().thinkingLevel, "medium");
    assert.ok(latestNotice(harness).message.includes("Recap Thinking Level clamped to medium"));

    harness.registry.models = [];
    clearRecordedUI(harness);
    await harness.command("model missing/new-model");
    assert.deepEqual(harness.readConfig().recapModel, {
      provider: "missing",
      id: "new-model"
    });
    assert.equal(latestNotice(harness).type, "warning");
    assert.ok(latestNotice(harness).message.includes("Recap Model setting was saved"));

    await harness.command("model none");
    assert.equal(harness.readConfig().recapModel, null);
    await harness.command("thinking max");
    assert.equal(harness.readConfig().thinkingLevel, "max");
  });

  test("persists numeric settings and reports the active configuration", async () => {
    const { harness } = createTypedSettingsHarness();
    await harness.start();
    await harness.command("messages 12");
    await harness.command("words 7");
    assert.equal(harness.readConfig().recentMessageLimit, 12);
    assert.equal(harness.readConfig().wordLimit, 7);

    clearRecordedUI(harness);
    await harness.command("config");
    assert.deepEqual(latestNotice(harness), {
      message:
        "Recap: model=limited/model thinking=low auto=off idleDelay=300s recentMessages=12 maxWords=7",
      type: "info"
    });
  });

  test("reports invalid typed commands without generating", async () => {
    const { harness } = createTypedSettingsHarness();
    await harness.start();
    const beforeInvalidCommands = harness.completionCount();

    clearRecordedUI(harness);
    await harness.command("auto");
    assert.equal(latestNotice(harness).type, "warning");
    assert.ok(latestNotice(harness).message.startsWith("Usage: /recap"));

    clearRecordedUI(harness);
    await harness.command("on");
    assert.equal(latestNotice(harness).type, "warning");
    assert.ok(latestNotice(harness).message.includes("auto on"));
    assert.equal(harness.completionCount(), beforeInvalidCommands);
  });

  test("opens settings only in TUI mode and applies saved changes", async () => {
    const { harness } = createTypedSettingsHarness();
    await harness.start();
    harness.state.hasUI = false;
    clearRecordedUI(harness);
    await harness.command("settings");
    assert.deepEqual(latestNotice(harness), {
      message:
        "Recap: interactive settings require TUI mode. Typed /recap subcommands remain available.",
      type: "warning"
    });
    assert.equal(harness.menuOpenCount(), 0);
    assert.equal(harness.completionCount(), 0);

    harness.state.hasUI = true;
    harness.setMenuBehavior((deps) => {
      deps.onSaved({ ...harness.readConfig(), autoRecapEnabled: false, idleDelaySeconds: 42 });
    });
    await harness.command("settings");
    assert.equal(harness.menuOpenCount(), 1);
    assert.equal(harness.runtime.inspect().autoRecapEnabled, false);
    assert.equal(harness.runtime.inspect().currentIdleDelaySeconds, 42);
    assert.equal(harness.timers.count(), 0);
  });

  test("runs recaps after resume and compaction", async () => {
    const model = makeModel();
    const config: RecapConfig = {
      ...DEFAULT_CONFIG,
      recapModel: { provider: model.provider, id: model.id },
      autoRecapEnabled: false
    };
    const harness = createHarness({ config, models: [model], leafId: "startup-leaf" });
    harness.queueResponse("Resume recap.");
    await harness.start("resume");
    assert.equal(harness.completionCount(), 1);
    assert.equal(harness.runtime.inspect().lastRecapText, "Resume recap.");

    harness.state.leafId = "compaction-leaf";
    harness.queueResponse("Compaction recap.");
    await harness.emit("session_compact");
    assert.equal(harness.completionCount(), 2);
    assert.equal(harness.runtime.inspect().lastRecapText, "Compaction recap.");
  });

  test("merges a stale preflight clamp into the latest configuration", async () => {
    const model = makeModel({ provider: "limited" }, ["off", "low", "medium"]);
    const harness = createHarness({
      config: {
        ...DEFAULT_CONFIG,
        recapModel: { provider: model.provider, id: model.id },
        thinkingLevel: "max"
      },
      models: [model]
    });
    await harness.start();

    let releaseRefresh = (): void => undefined;
    const refreshStarted = new Promise<void>((resolveStarted) => {
      harness.registry.refreshImplementation = () =>
        new Promise<void>((resolveRefresh) => {
          releaseRefresh = resolveRefresh;
          resolveStarted();
        });
    });

    const recap = harness.command("");
    await refreshStarted;
    await harness.command("auto off");
    assert.equal(harness.readConfig().autoRecapEnabled, false);
    assert.equal(harness.readConfig().thinkingLevel, "max");

    releaseRefresh();
    await recap;
    assert.equal(harness.readConfig().autoRecapEnabled, false);
    assert.equal(harness.readConfig().thinkingLevel, "medium");
    assert.ok(
      harness.ui.notices.some((notice) =>
        notice.message.includes("Recap Thinking Level clamped to medium")
      )
    );
  });

  test("bounds a stalled registry refresh while using cached models", async () => {
    const model = makeModel();
    const harness = createHarness({
      config: { ...DEFAULT_CONFIG, recapModel: { provider: model.provider, id: model.id } },
      models: [model],
      refreshTimeoutMs: 1
    });
    harness.registry.refreshImplementation = () => new Promise<void>(() => undefined);
    await harness.start();
    await harness.command("");
    assert.equal(harness.completionCount(), 1);
    assert.equal(harness.runtime.inspect().pending, false);
    assert.equal(
      harness.ui.notices.some((notice) => notice.message.includes("refresh timed out")),
      false
    );
    await harness.command("");
    assert.equal(harness.completionCount(), 2);
  });

  test("uses cached models after a rejected registry refresh", async () => {
    const model = makeModel();
    const harness = createHarness({ models: [model] });
    harness.registry.refreshImplementation = () => Promise.reject(new Error("provider offline"));
    await harness.start();

    await harness.command(`model ${model.provider}/${model.id}`);
    assert.deepEqual(harness.readConfig().recapModel, { provider: model.provider, id: model.id });
    await harness.command("thinking high");
    assert.equal(harness.readConfig().thinkingLevel, "high");
    assert.equal(
      harness.ui.notices.some((notice) => notice.message.includes("refresh failed")),
      false
    );
  });

  test("reports a clamp save failure without aborting generation", async () => {
    const model = makeModel({ provider: "limited" }, ["off", "low", "medium"]);
    const harness = createHarness({
      config: {
        ...DEFAULT_CONFIG,
        recapModel: { provider: model.provider, id: model.id },
        thinkingLevel: "max",
        autoRecapEnabled: false
      },
      models: [model]
    });
    await harness.start();
    clearRecordedUI(harness);
    harness.setAgentDirMode(0o555);
    harness.queueResponse("Recap survives a failed clamp save.");

    await harness.command("");
    const saveFailure = harness.ui.notices.find((notice) =>
      notice.message.startsWith("Recap: could not save the effective Recap Thinking Level:")
    );
    assert.equal(saveFailure?.type, "error");
    assert.equal(harness.completionCount(), 1);
    assert.equal(harness.runtime.inspect().lastRecapText, "Recap survives a failed clamp save.");
  });

  test("rejects a stale clamp after the thinking level changes", async () => {
    const model = makeModel({ provider: "limited" }, ["off", "low", "medium"]);
    const harness = createHarness({
      config: {
        ...DEFAULT_CONFIG,
        recapModel: { provider: model.provider, id: model.id },
        thinkingLevel: "max",
        autoRecapEnabled: false
      },
      models: [model]
    });
    await harness.start();

    let releaseRefresh = (): void => undefined;
    const refreshStarted = new Promise<void>((resolveStarted) => {
      harness.registry.refreshImplementation = () =>
        new Promise<void>((resolveRefresh) => {
          releaseRefresh = resolveRefresh;
          resolveStarted();
        });
    });
    const recap = harness.command("");
    await refreshStarted;
    harness.registry.refreshImplementation = null;
    await harness.command("thinking low");
    assert.equal(harness.readConfig().thinkingLevel, "low");
    clearRecordedUI(harness);

    releaseRefresh();
    await recap;
    assert.equal(harness.readConfig().thinkingLevel, "low");
    assert.equal(
      harness.ui.notices.some((notice) =>
        notice.message.includes("Recap Thinking Level clamped to medium")
      ),
      false
    );
  });

  test("drops an in-flight result after user activity", async () => {
    const model = makeModel();
    const harness = createHarness({
      config: { ...DEFAULT_CONFIG, recapModel: { provider: model.provider, id: model.id } },
      models: [model],
      leafId: "input-leaf"
    });
    await harness.start();
    harness.queueResponse("Stable recap.");
    await harness.command("");
    const stableState = harness.runtime.inspect();

    const deferred = harness.deferNextCompletion();
    const recap = harness.command("");
    await deferred.started;
    await harness.emitWithoutWaiting("input");
    const widgetCountAfterInput = harness.ui.widgets.length;
    deferred.resolve("Stale recap after input.");
    await recap;

    assert.equal(harness.runtime.inspect().lastRecapText, stableState.lastRecapText);
    assert.equal(harness.runtime.inspect().lastRecapEntryId, stableState.lastRecapEntryId);
    assert.equal(harness.ui.widgets.length, widgetCountAfterInput);
  });

  test("prevents in-flight work from restoring state after shutdown", async () => {
    const model = makeModel();
    const harness = createHarness({
      config: {
        ...DEFAULT_CONFIG,
        recapModel: { provider: model.provider, id: model.id },
        idleDelaySeconds: 1
      },
      models: [model]
    });
    await harness.start();
    assert.equal(harness.timers.count(), 1);

    const deferred = harness.deferNextCompletion();
    const recap = harness.command("");
    await deferred.started;
    await harness.emitWithoutWaiting("session_shutdown");
    assert.equal(harness.runtime.inspect().alive, false);
    assert.equal(harness.timers.count(), 0);
    assert.equal(harness.ui.widgets.at(-1)?.cleared, true);
    const widgetCountAfterShutdown = harness.ui.widgets.length;

    deferred.resolve("Stale recap after shutdown.");
    await recap;
    assert.equal(harness.runtime.inspect().lastRecapText, null);
    assert.equal(harness.runtime.inspect().lastRecapEntryId, null);
    assert.equal(harness.timers.count(), 0);
    assert.equal(harness.ui.widgets.length, widgetCountAfterShutdown);

    for (const event of ["input", "turn_start", "agent_end", "session_compact"]) {
      await harness.emitWithoutWaiting(event);
    }
    assert.equal(harness.runtime.inspect().alive, false);
    assert.equal(harness.timers.count(), 0);
    assert.equal(harness.ui.widgets.length, widgetCountAfterShutdown);
  });

  test("drops an in-flight result after the session leaf changes", async () => {
    const model = makeModel();
    const harness = createHarness({
      config: { ...DEFAULT_CONFIG, recapModel: { provider: model.provider, id: model.id } },
      models: [model],
      leafId: "original-leaf"
    });
    await harness.start();
    const deferred = harness.deferNextCompletion();
    const recap = harness.command("");
    await deferred.started;
    harness.state.leafId = "new-leaf";
    deferred.resolve("Stale recap for the original leaf.");
    await recap;
    assert.equal(harness.runtime.inspect().lastRecapText, null);
    assert.equal(harness.runtime.inspect().lastRecapEntryId, null);
  });

  test("blocks concurrent manual refreshes", async () => {
    const model = makeModel();
    const harness = createHarness({
      config: { ...DEFAULT_CONFIG, recapModel: { provider: model.provider, id: model.id } },
      models: [model]
    });
    await harness.start();
    const deferred = harness.deferNextCompletion();
    const first = harness.command("");
    await deferred.started;
    await harness.command("");
    assert.equal(harness.completionCount(), 1);
    assert.deepEqual(latestNotice(harness), {
      message: "Recap: a refresh is already in progress.",
      type: "info"
    });
    deferred.resolve("Only one recap.");
    await first;
    assert.equal(harness.completionCount(), 1);
  });

  test("rearms the idle timer after a non-idle tick", async () => {
    const model = makeModel();
    const harness = createHarness({
      config: {
        ...DEFAULT_CONFIG,
        recapModel: { provider: model.provider, id: model.id },
        idleDelaySeconds: 1
      },
      models: [model]
    });
    await harness.start();
    harness.state.idle = false;
    harness.timers.advance(1_000);
    await harness.runtime.waitForBackgroundTasks();
    assert.equal(harness.completionCount(), 0);
    assert.equal(harness.timers.nextDelay(), 1_000);
  });
});
