import type { Api, Model } from "@earendil-works/pi-ai";
import {
  initTheme,
  type ExtensionContext,
  type Theme,
  type ThemeColor
} from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  type Component,
  type KeybindingsManager,
  type TUI
} from "@earendil-works/pi-tui";
import assert from "node:assert/strict";
import {
  applyAutoToggle,
  applyModelSelection,
  applyNumericValue,
  applyThinkingSelection,
  createRecapSettingsController,
  openRecapSettingsMenu,
  parseCustomNumeric,
  performSave,
  RecapSettingsController,
  type NumericField
} from "../src/settings-menu";
import { type RecapConfig, THINKING_LEVELS } from "../src/config";
import {
  DEFAULT_RECAP_CONFIG as DEFAULT_CONFIG,
  FakeRegistry,
  makeModel,
  type Notice
} from "./test-support";

initTheme("dark");

const ENTER = "\r";
const ESCAPE = "\x1b";
const DOWN = "\x1b[B";

function copyConfig(config: RecapConfig): RecapConfig {
  return {
    ...config,
    recapModel:
      config.recapModel === null
        ? null
        : { provider: config.recapModel.provider, id: config.recapModel.id }
  };
}

interface Harness {
  controller: RecapSettingsController;
  registry: FakeRegistry;
  notices: Notice[];
  saved: RecapConfig[];
  applied: RecapConfig[];
  closed: ("saved" | "cancelled")[];
  events: string[];
  renderCount(): number;
}

async function createHarness(
  initialConfig: RecapConfig = DEFAULT_CONFIG,
  models: readonly Model<Api>[] = [],
  saveError: Error | null = null,
  refreshTimeoutMs?: number
): Promise<Harness> {
  const registry = new FakeRegistry(models);
  const notices: Notice[] = [];
  const saved: RecapConfig[] = [];
  const applied: RecapConfig[] = [];
  const closed: ("saved" | "cancelled")[] = [];
  const events: string[] = [];
  let renders = 0;
  const controller = await createRecapSettingsController({
    tui: {
      requestRender: () => {
        renders++;
      }
    },
    theme: {
      fg: (_color: ThemeColor, text: string) => text
    },
    keybindings: getKeybindings(),
    initialConfig,
    registry,
    saveConfig: (config) => {
      if (saveError !== null) throw saveError;
      events.push("save");
      saved.push(copyConfig(config));
    },
    onSaved: (config) => {
      events.push("onSaved");
      applied.push(copyConfig(config));
    },
    notify: (message, type) => {
      notices.push({ message, type });
    },
    done: (result) => {
      events.push("close");
      closed.push(result);
    },
    refreshTimeoutMs
  });
  return {
    controller,
    registry,
    notices,
    saved,
    applied,
    closed,
    events,
    renderCount: () => renders
  };
}

async function press(controller: RecapSettingsController, ...keys: string[]): Promise<void> {
  for (const key of keys) await controller.handleKey(key);
}

async function selectOption(controller: RecapSettingsController, value: string): Promise<void> {
  for (let attempts = 0; attempts < 20; attempts++) {
    if (controller.inspect().selectedValue === value) {
      await controller.handleKey(ENTER);
      return;
    }
    await controller.handleKey(DOWN);
  }
  assert.fail(`Could not select option ${value}`);
}

async function openMainRow(controller: RecapSettingsController, value: string): Promise<void> {
  assert.equal(controller.inspect().screen, "main");
  await selectOption(controller, value);
}

async function openCustomInput(
  controller: RecapSettingsController,
  mainValue: "delay" | "messages" | "words"
): Promise<void> {
  await openMainRow(controller, mainValue);
  assert.equal(controller.inspect().screen, "preset");
  await selectOption(controller, "custom");
  assert.equal(controller.inspect().screen, "customInput");
}

const limitedModel = makeModel(
  { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
  ["off", "low", "medium"]
);

// Reducer layer
const genericThinking = applyThinkingSelection(DEFAULT_CONFIG, "max");
assert.equal(genericThinking.thinkingLevel, "max");
assert.equal(genericThinking.recapModel, null);
assert.equal(DEFAULT_CONFIG.thinkingLevel, "low");

const maxDraft: RecapConfig = { ...DEFAULT_CONFIG, thinkingLevel: "max" };
const modelDraft = applyModelSelection(maxDraft, {
  ref: { provider: limitedModel.provider, id: limitedModel.id },
  model: limitedModel
});
assert.deepEqual(modelDraft.recapModel, {
  provider: limitedModel.provider,
  id: limitedModel.id
});
assert.equal(modelDraft.thinkingLevel, "medium");
assert.equal(maxDraft.thinkingLevel, "max");

const noModelDraft = applyModelSelection(maxDraft, null);
assert.equal(noModelDraft.recapModel, null);
assert.equal(noModelDraft.thinkingLevel, "max");

const autoOff = applyAutoToggle(DEFAULT_CONFIG, false);
assert.equal(autoOff.autoRecapEnabled, false);
assert.equal(autoOff.idleDelaySeconds, DEFAULT_CONFIG.idleDelaySeconds);
assert.equal(DEFAULT_CONFIG.autoRecapEnabled, true);

const numericDraft = applyNumericValue(DEFAULT_CONFIG, "wordLimit", 75);
assert.equal(numericDraft.wordLimit, 75);
assert.equal(DEFAULT_CONFIG.wordLimit, 100);

assert.equal(parseCustomNumeric(" 42 "), 42);
for (const invalid of ["", "0", "-1", "+1", "1.5", "1e3", "junk", "9007199254740992"]) {
  assert.equal(parseCustomNumeric(invalid), null);
}

let reducerSaveCalls = 0;
applyThinkingSelection(DEFAULT_CONFIG, "high");
applyAutoToggle(DEFAULT_CONFIG, false);
applyNumericValue(DEFAULT_CONFIG, "idleDelaySeconds", 120);
assert.equal(reducerSaveCalls, 0);

const vanishedRegistry = new FakeRegistry([]);
const vanishedNotices: Notice[] = [];
const vanishedResult = await performSave(
  {
    ...DEFAULT_CONFIG,
    recapModel: { provider: limitedModel.provider, id: limitedModel.id }
  },
  {
    registry: vanishedRegistry,
    saveConfig: () => {
      reducerSaveCalls++;
    },
    onSaved: () => {
      assert.fail("onSaved must not run for a vanished model");
    },
    notify: (message, type) => {
      vanishedNotices.push({ message, type });
    },
    done: () => {
      assert.fail("A rejected save must not close the menu");
    }
  }
);
assert.deepEqual(vanishedResult, { ok: false, reason: "model-unavailable" });
assert.equal(reducerSaveCalls, 0);
assert.deepEqual(vanishedNotices, [
  {
    message: "Recap: anthropic/claude-sonnet is no longer available; choose another Recap Model.",
    type: "warning"
  }
]);

const saveOrder: string[] = [];
const successResult = await performSave(
  {
    ...DEFAULT_CONFIG,
    recapModel: { provider: limitedModel.provider, id: limitedModel.id },
    thinkingLevel: "max"
  },
  {
    registry: new FakeRegistry([limitedModel]),
    saveConfig: (config) => {
      saveOrder.push(`save:${config.thinkingLevel}`);
    },
    onSaved: (config) => {
      saveOrder.push(`onSaved:${config.thinkingLevel}`);
    },
    notify: (_message, type) => {
      saveOrder.push(`notify:${type}`);
    },
    done: (result) => {
      saveOrder.push(`close:${result}`);
    }
  }
);
assert.deepEqual(successResult, {
  ok: true,
  config: {
    ...DEFAULT_CONFIG,
    recapModel: { provider: limitedModel.provider, id: limitedModel.id },
    thinkingLevel: "medium"
  },
  clampedFrom: "max"
});
assert.deepEqual(saveOrder, ["save:medium", "onSaved:medium", "notify:info", "close:saved"]);

// The real ui.custom wrapper uses the same headless controller factory.
{
  const registry = new FakeRegistry([]);
  let customOptions: { overlay?: boolean } | undefined;
  const fakeTui = { requestRender: () => undefined } as unknown as TUI;
  const fakeTheme = {
    fg: (_color: ThemeColor, text: string) => text
  } as unknown as Theme;
  const customImplementation = async <T>(
    factory: (
      tui: TUI,
      theme: Theme,
      keybindings: KeybindingsManager,
      done: (value: T) => void
    ) => Component | Promise<Component>,
    options?: { overlay?: boolean }
  ): Promise<T> => {
    customOptions = options;
    const result: { value?: T } = {};
    const component: Component = await factory(fakeTui, fakeTheme, getKeybindings(), (value) => {
      result.value = value;
    });
    assert.ok(component instanceof RecapSettingsController);
    component.handleInput(ESCAPE);
    await component.waitForIdle();
    assert.ok(result.value !== undefined);
    return result.value;
  };
  const custom = customImplementation as unknown as ExtensionContext["ui"]["custom"];
  const ui = {
    custom,
    notify: () => undefined
  } as unknown as ExtensionContext["ui"];
  await openRecapSettingsMenu({
    ui,
    registry,
    loadConfig: () => DEFAULT_CONFIG,
    saveConfig: () => {
      assert.fail("Escape through ui.custom must not save");
    },
    onSaved: () => {
      assert.fail("Escape through ui.custom must not apply runtime state");
    }
  });
  assert.equal(customOptions?.overlay, true);
  assert.equal(registry.refreshCount, 1);
}

// A stalled refresh on model-submenu entry is bounded, so the serialized input queue can
// continue processing Escape.
{
  const harness = await createHarness(DEFAULT_CONFIG, [], null, 1);
  harness.registry.refreshImplementation = () => new Promise<void>(() => undefined);
  await openMainRow(harness.controller, "model");
  assert.equal(harness.controller.inspect().screen, "model");
  assert.deepEqual(harness.notices.at(-1), {
    message: "Recap: model availability refresh timed out; using cached model information.",
    type: "warning"
  });
  await harness.controller.handleKey(ESCAPE);
  assert.equal(harness.controller.inspect().screen, "main");
}

// Controller layer: main stack, Escape behavior, and all seven main rows.
{
  const harness = await createHarness();
  const rows = [
    ["model", "model"],
    ["thinking", "thinking"],
    ["auto", "auto"],
    ["delay", "preset"],
    ["messages", "preset"],
    ["words", "preset"]
  ] as const;
  for (const [row, expectedScreen] of rows) {
    await openMainRow(harness.controller, row);
    assert.equal(harness.controller.inspect().screen, expectedScreen);
    await harness.controller.handleKey(ESCAPE);
    assert.equal(harness.controller.inspect().screen, "main");
  }
  assert.equal(harness.saved.length, 0);
  assert.equal(harness.applied.length, 0);
  await openMainRow(harness.controller, "save");
  assert.deepEqual(harness.closed, ["saved"]);
}

{
  const harness = await createHarness();
  await harness.controller.handleKey(ESCAPE);
  assert.deepEqual(harness.closed, ["cancelled"]);
  assert.equal(harness.saved.length, 0);
  assert.equal(harness.applied.length, 0);
}

{
  const harness = await createHarness();
  await openMainRow(harness.controller, "auto");
  await selectOption(harness.controller, "off");
  await openMainRow(harness.controller, "delay");
  await selectOption(harness.controller, "600");
  assert.equal(harness.controller.inspect().draft.autoRecapEnabled, false);
  assert.equal(harness.controller.inspect().draft.idleDelaySeconds, 600);
  await harness.controller.handleKey(ESCAPE);
  assert.deepEqual(harness.closed, ["cancelled"]);
  assert.equal(harness.saved.length, 0);
  assert.equal(harness.applied.length, 0);
}

{
  const harness = await createHarness();
  const before = harness.controller.inspect().draft;
  await openMainRow(harness.controller, "auto");
  await harness.controller.handleKey(ESCAPE);
  assert.deepEqual(harness.controller.inspect().draft, before);
  assert.equal(harness.saved.length, 0);
}

// Successful Save persists once, applies runtime state, then closes.
{
  const harness = await createHarness();
  await openMainRow(harness.controller, "auto");
  await selectOption(harness.controller, "off");
  await openMainRow(harness.controller, "delay");
  await selectOption(harness.controller, "600");
  await openMainRow(harness.controller, "save");
  assert.equal(harness.saved.length, 1);
  assert.equal(harness.applied.length, 1);
  assert.deepEqual(harness.saved[0], harness.applied[0]);
  assert.equal(harness.saved[0]?.autoRecapEnabled, false);
  assert.equal(harness.saved[0]?.idleDelaySeconds, 600);
  assert.deepEqual(harness.events, ["save", "onSaved", "close"]);
  assert.deepEqual(harness.closed, ["saved"]);
}

// Rejected and failed saves keep the controller open and do not apply runtime state.
{
  const initial = {
    ...DEFAULT_CONFIG,
    recapModel: { provider: limitedModel.provider, id: limitedModel.id }
  };
  const harness = await createHarness(initial, [limitedModel]);
  harness.registry.models = [];
  await openMainRow(harness.controller, "save");
  assert.equal(harness.controller.inspect().screen, "main");
  assert.equal(harness.saved.length, 0);
  assert.equal(harness.applied.length, 0);
  assert.deepEqual(harness.closed, []);
  assert.equal(harness.notices.at(-1)?.type, "warning");
}

{
  const harness = await createHarness(DEFAULT_CONFIG, [], new Error("disk full"));
  await openMainRow(harness.controller, "save");
  assert.equal(harness.controller.inspect().screen, "main");
  assert.equal(harness.saved.length, 0);
  assert.equal(harness.applied.length, 0);
  assert.deepEqual(harness.closed, []);
  assert.deepEqual(harness.notices.at(-1), { message: "Recap: disk full", type: "error" });
}

// Model filtering matches id, provider, and name independently.
const searchableModels = [
  makeModel({ provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" }, ["off", "low"]),
  makeModel({ provider: "openrouter", id: "deepseek/deepseek-r1", name: "Orchid Reasoner" }, [
    "off",
    "low"
  ]),
  makeModel({ provider: "google", id: "gemini-pro", name: "Gemini Pro" }, ["off", "low"])
];
for (const [query, expectedLabel] of [
  ["gemini-pro", "gemini-pro"],
  ["openrouter", "deepseek/deepseek-r1"],
  ["orchid", "deepseek/deepseek-r1"]
] as const) {
  const harness = await createHarness(DEFAULT_CONFIG, searchableModels);
  await openMainRow(harness.controller, "model");
  await harness.controller.handleKey(query);
  assert.deepEqual(harness.controller.inspect().options, [expectedLabel]);
}

// Model selection updates both the model label and the clamped draft atomically.
{
  const harness = await createHarness({ ...DEFAULT_CONFIG, thinkingLevel: "max" }, [limitedModel]);
  await openMainRow(harness.controller, "model");
  await selectOption(harness.controller, "model:0");
  const inspection = harness.controller.inspect();
  assert.deepEqual(inspection.draft.recapModel, {
    provider: limitedModel.provider,
    id: limitedModel.id
  });
  assert.equal(inspection.draft.thinkingLevel, "medium");
  assert.equal(inspection.options[0], "Recap Model: anthropic/claude-sonnet");

  await openMainRow(harness.controller, "thinking");
  assert.deepEqual(harness.controller.inspect().options, ["off", "low", "medium"]);
  await selectOption(harness.controller, "low");
  assert.equal(harness.controller.inspect().draft.thinkingLevel, "low");
}

{
  const harness = await createHarness();
  await openMainRow(harness.controller, "thinking");
  assert.deepEqual(harness.controller.inspect().options, THINKING_LEVELS);
  await selectOption(harness.controller, "max");
  assert.equal(harness.controller.inspect().draft.thinkingLevel, "max");
}

// Auto Recap toggles both ways without changing Idle Delay.
{
  const harness = await createHarness();
  await openMainRow(harness.controller, "auto");
  await selectOption(harness.controller, "off");
  assert.equal(harness.controller.inspect().draft.autoRecapEnabled, false);
  assert.equal(harness.controller.inspect().draft.idleDelaySeconds, 300);
  await openMainRow(harness.controller, "auto");
  await selectOption(harness.controller, "on");
  assert.equal(harness.controller.inspect().draft.autoRecapEnabled, true);
  assert.equal(harness.controller.inspect().draft.idleDelaySeconds, 300);
}

// Each preset screen updates only its field.
for (const [mainValue, field, preset] of [
  ["delay", "idleDelaySeconds", "600"],
  ["messages", "recentMessageLimit", "30"],
  ["words", "wordLimit", "150"]
] as const) {
  const harness = await createHarness();
  await openMainRow(harness.controller, mainValue);
  await selectOption(harness.controller, preset);
  assert.equal(harness.controller.inspect().draft[field], Number(preset));
}

// Every custom field accepts valid input, rejects invalid input, and cancels without mutation.
const customFields: readonly ["delay" | "messages" | "words", NumericField, number][] = [
  ["delay", "idleDelaySeconds", 47],
  ["messages", "recentMessageLimit", 23],
  ["words", "wordLimit", 88]
];
for (const [mainValue, field, validValue] of customFields) {
  {
    const harness = await createHarness();
    await openCustomInput(harness.controller, mainValue);
    await press(harness.controller, String(validValue), ENTER);
    assert.equal(harness.controller.inspect().screen, "main");
    assert.equal(harness.controller.inspect().draft[field], validValue);
  }

  {
    const harness = await createHarness();
    const original = harness.controller.inspect().draft[field];
    await openCustomInput(harness.controller, mainValue);
    const rendersBefore = harness.renderCount();
    await press(harness.controller, "0", ENTER);
    assert.equal(harness.controller.inspect().screen, "customInput");
    assert.equal(harness.controller.inspect().draft[field], original);
    assert.equal(harness.controller.inspect().error, "Enter a positive whole number.");
    assert.match(harness.controller.render(80).join("\n"), /Enter a positive whole number\./);
    assert.ok(harness.renderCount() > rendersBefore);
    await harness.controller.handleKey(ESCAPE);
    assert.equal(harness.controller.inspect().screen, "preset");
    assert.equal(harness.controller.inspect().draft[field], original);
  }

  {
    const harness = await createHarness();
    const original = harness.controller.inspect().draft[field];
    await openCustomInput(harness.controller, mainValue);
    await press(harness.controller, String(validValue), ESCAPE);
    assert.equal(harness.controller.inspect().screen, "preset");
    assert.equal(harness.controller.inspect().draft[field], original);
  }
}

// A draft model can vanish after menu entry. Thinking falls back to all levels and Save rejects.
{
  const initial = {
    ...DEFAULT_CONFIG,
    recapModel: { provider: limitedModel.provider, id: limitedModel.id },
    thinkingLevel: "medium" as const
  };
  const harness = await createHarness(initial, [limitedModel]);
  harness.registry.models = [];
  await openMainRow(harness.controller, "thinking");
  assert.deepEqual(harness.controller.inspect().options, THINKING_LEVELS);
  await harness.controller.handleKey(ESCAPE);
  await openMainRow(harness.controller, "save");
  assert.equal(harness.saved.length, 0);
  assert.deepEqual(harness.closed, []);
  assert.equal(harness.notices.at(-1)?.type, "warning");
}

// An empty available-model list still exposes None as a usable choice.
{
  const harness = await createHarness();
  await openMainRow(harness.controller, "model");
  assert.deepEqual(harness.controller.inspect().options, ["None"]);
  await harness.controller.handleKey(ENTER);
  assert.equal(harness.controller.inspect().screen, "main");
  assert.equal(harness.controller.inspect().draft.recapModel, null);
}

console.log("test-menu: passed");
