import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getSelectListTheme, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Box,
  Container,
  Input,
  SelectList,
  SettingsList,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
  type KeybindingsManager,
  type SelectItem,
  type SelectListTheme,
  type SettingItem,
  type TUI
} from "@earendil-works/pi-tui";
import {
  errorMessage,
  parsePositiveSafeInt,
  refreshModelRegistry,
  type RecapConfig,
  type RecapModelRef,
  type StoredThinkingLevel,
  THINKING_LEVELS
} from "./config";

export type SettingsDraft = RecapConfig;

export type NumericField = "idleDelaySeconds" | "recentMessageLimit" | "wordLimit";

export type SettingsScreenKind = "main" | "model" | "thinking" | "auto" | "preset" | "customInput";

type NotificationType = "info" | "warning" | "error";
type MenuResult = "saved" | "cancelled";

export interface RecapModelRegistry {
  refresh(): Promise<void>;
  find(provider: string, id: string): Model<Api> | undefined;
  getAvailable(): Model<Api>[];
}

export interface PerformSaveDeps {
  registry: RecapModelRegistry;
  saveConfig(config: RecapConfig): void;
  onSaved(config: RecapConfig): void;
  notify(message: string, type: NotificationType): void;
  done(result: MenuResult): void;
  refreshTimeoutMs?: number;
}

export interface RecapSettingsMenuDeps {
  ui: ExtensionContext["ui"];
  registry: RecapModelRegistry;
  loadConfig(): RecapConfig;
  saveConfig(config: RecapConfig): void;
  onSaved(config: RecapConfig): void;
  refreshTimeoutMs?: number;
}

export interface SettingsMenuInspection {
  screen: SettingsScreenKind;
  draft: RecapConfig;
  options: string[];
  selectedValue: string | null;
  filter: string | null;
  error: string | null;
}

export interface CreateRecapSettingsControllerOptions extends PerformSaveDeps {
  tui: Pick<TUI, "requestRender">;
  theme: Pick<Theme, "bg" | "bold" | "fg">;
  keybindings: KeybindingsManager;
  initialConfig: RecapConfig;
}

interface MainScreen {
  kind: "main";
}

interface ModelEntry {
  item: SelectItem;
  selection: { ref: RecapModelRef; model: Model<Api> } | null;
  searchText: string;
}

interface ModelScreen {
  kind: "model";
  component: InteractiveContainer;
  input: Input;
  list: SelectList;
  entries: ModelEntry[];
  visibleEntries: ModelEntry[];
  selected: SelectItem | null;
  done(selectedValue?: string): void;
}

interface ChoiceScreen {
  kind: "thinking";
  component: InteractiveContainer;
  list: SelectList;
  items: SelectItem[];
  selected: SelectItem | null;
  done(selectedValue?: string): void;
}

interface PresetScreen {
  kind: "preset";
  component: InteractiveContainer;
  list: SelectList;
  items: SelectItem[];
  field: NumericField;
  selected: SelectItem | null;
  done(selectedValue?: string): void;
}

interface CustomInputScreen {
  kind: "customInput";
  component: InteractiveContainer;
  input: Input;
  errorText: Text;
  field: NumericField;
  parent: PresetScreen;
  submitted: string | null;
  cancelled: boolean;
  error: string | null;
}

type SettingsScreen = MainScreen | ModelScreen | ChoiceScreen | PresetScreen | CustomInputScreen;

type SelectableScreen = ModelScreen | ChoiceScreen | PresetScreen;

const MAIN_VALUES = ["model", "thinking", "auto", "delay", "messages", "words", "save"] as const;

const FIELD_LABELS: Record<NumericField, string> = {
  idleDelaySeconds: "Idle Delay",
  recentMessageLimit: "Recent Messages",
  wordLimit: "Maximum Words"
};

const FIELD_PRESETS: Record<NumericField, readonly number[]> = {
  idleDelaySeconds: [60, 120, 300, 600, 900],
  recentMessageLimit: [10, 20, 30, 50],
  wordLimit: [50, 75, 100, 150, 200]
};

const NUMERIC_ITEM_FIELDS = {
  delay: "idleDelaySeconds",
  messages: "recentMessageLimit",
  words: "wordLimit"
} as const satisfies Record<string, NumericField>;

class InteractiveContainer extends Container {
  private onInput: (data: string) => void = () => undefined;

  setInputHandler(onInput: (data: string) => void): void {
    this.onInput = onInput;
  }

  handleInput(data: string): void {
    this.onInput(data);
  }
}

class RecapSettingsFrame {
  private readonly box: Box;

  constructor(
    content: SettingsList,
    private readonly theme: Pick<Theme, "bg" | "fg">
  ) {
    this.box = new Box(1, 0, (text) => this.theme.bg("customMessageBg", text));
    this.box.addChild(content);
  }

  invalidate(): void {
    this.box.invalidate();
  }

  render(width: number): string[] {
    const frameWidth = Math.max(4, width);
    const contentWidth = frameWidth - 2;
    const contentLines = this.box.render(contentWidth);
    const border = (text: string): string => this.theme.fg("borderMuted", text);
    const titlePrefix = "╭─ Recap Settings ";
    const top =
      visibleWidth(titlePrefix) + 1 <= frameWidth
        ? `${titlePrefix}${"─".repeat(frameWidth - visibleWidth(titlePrefix) - 1)}╮`
        : `╭${"─".repeat(frameWidth - 2)}╮`;

    return [
      border(top),
      ...contentLines.map((line) => {
        const fitted = truncateToWidth(line, contentWidth, "", true);
        return `${border("│")}${fitted}${border("│")}`;
      }),
      border(`╰${"─".repeat(frameWidth - 2)}╯`)
    ];
  }
}

function copyConfig(config: RecapConfig): RecapConfig {
  return {
    ...config,
    recapModel:
      config.recapModel === null
        ? null
        : { provider: config.recapModel.provider, id: config.recapModel.id }
  };
}

export function applyModelSelection(
  draft: SettingsDraft,
  selection: { ref: RecapModelRef; model: Model<Api> } | null
): SettingsDraft {
  if (selection === null) {
    return { ...draft, recapModel: null };
  }

  return {
    ...draft,
    recapModel: { provider: selection.ref.provider, id: selection.ref.id },
    thinkingLevel: clampThinkingLevel(selection.model, draft.thinkingLevel)
  };
}

export function applyThinkingSelection(
  draft: SettingsDraft,
  level: StoredThinkingLevel
): SettingsDraft {
  return { ...draft, thinkingLevel: level };
}

export function applyAutoToggle(draft: SettingsDraft, enabled: boolean): SettingsDraft {
  return { ...draft, autoRecapEnabled: enabled };
}

export function applyNumericValue(
  draft: SettingsDraft,
  field: NumericField,
  value: number
): SettingsDraft {
  return { ...draft, [field]: value };
}

export function parseCustomNumeric(raw: string): number | null {
  return parsePositiveSafeInt(raw);
}

export function thinkingLevelChoices(model: Model<Api> | null): StoredThinkingLevel[] {
  return model === null ? [...THINKING_LEVELS] : [...getSupportedThinkingLevels(model)];
}

export async function performSave(
  draft: SettingsDraft,
  deps: PerformSaveDeps
): Promise<
  | { ok: true; config: RecapConfig; clampedFrom: StoredThinkingLevel | null }
  | { ok: false; reason: string }
> {
  await refreshModelRegistry(
    deps.registry,
    (message, type) => {
      deps.notify(message, type);
    },
    deps.refreshTimeoutMs
  );

  let resolvedModel: Model<Api> | null = null;
  if (draft.recapModel !== null) {
    resolvedModel =
      deps.registry
        .getAvailable()
        .find(
          (model) =>
            model.provider === draft.recapModel?.provider && model.id === draft.recapModel.id
        ) ?? null;

    if (resolvedModel === null) {
      const modelRef = `${draft.recapModel.provider}/${draft.recapModel.id}`;
      deps.notify(
        `Recap: ${modelRef} is no longer available; choose another Recap Model.`,
        "warning"
      );
      return { ok: false, reason: "model-unavailable" };
    }
  }

  const effectiveThinkingLevel =
    resolvedModel === null
      ? draft.thinkingLevel
      : clampThinkingLevel(resolvedModel, draft.thinkingLevel);
  const clampedFrom = effectiveThinkingLevel === draft.thinkingLevel ? null : draft.thinkingLevel;
  const config = copyConfig({ ...draft, thinkingLevel: effectiveThinkingLevel });

  try {
    deps.saveConfig(config);
  } catch (error) {
    deps.notify(`Recap: ${errorMessage(error)}`, "error");
    return { ok: false, reason: "save-failed" };
  }

  deps.onSaved(config);

  if (clampedFrom !== null && config.recapModel !== null) {
    deps.notify(
      `Recap: Recap Thinking Level clamped to ${config.thinkingLevel} for ${config.recapModel.provider}/${config.recapModel.id}.`,
      "info"
    );
  }

  deps.done("saved");
  return { ok: true, config, clampedFrom };
}

export class RecapSettingsController extends Container {
  private readonly options: CreateRecapSettingsControllerOptions;
  private readonly selectListTheme: SelectListTheme;
  private readonly mainItems: SettingItem[];
  private readonly mainList: SettingsList;
  private draft: SettingsDraft;
  private screen: SettingsScreen = { kind: "main" };
  private mainSelectionIndex = 0;
  private focusedState = false;
  private closed = false;
  private inputQueue: Promise<void> = Promise.resolve();
  private pendingMainChange: { id: string; value: string } | null = null;
  private pendingModelSelection: {
    selection: { ref: RecapModelRef; model: Model<Api> } | null;
  } | null = null;

  constructor(options: CreateRecapSettingsControllerOptions) {
    super();
    this.options = options;
    this.selectListTheme = getSelectListTheme();
    this.draft = copyConfig(options.initialConfig);
    this.mainItems = this.buildMainItems();
    this.mainList = new SettingsList(
      this.mainItems,
      this.mainItems.length,
      getSettingsListTheme(),
      (id, newValue) => {
        this.pendingMainChange = { id, value: newValue };
      },
      () => {
        this.close("cancelled");
      },
      { enableSearch: false }
    );
    this.addChild(new RecapSettingsFrame(this.mainList, options.theme));
    this.options.tui.requestRender();
  }

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.syncInputFocus();
  }

  handleInput(data: string): void {
    void this.enqueueInput(data);
  }

  handleKey(data: string): Promise<void> {
    return this.enqueueInput(data);
  }

  async waitForIdle(): Promise<void> {
    await this.inputQueue;
  }

  inspect(): SettingsMenuInspection {
    const list = this.screenList(this.screen);
    return {
      screen: this.screen.kind,
      draft: copyConfig(this.draft),
      options: this.screenItems(this.screen).map((item) => item.label),
      selectedValue:
        this.screen.kind === "main"
          ? (MAIN_VALUES[this.mainSelectionIndex] ?? null)
          : (list?.getSelectedItem()?.value ?? null),
      filter: this.screen.kind === "model" ? this.screen.input.getValue() : null,
      error: this.screen.kind === "customInput" ? this.screen.error : null
    };
  }

  private enqueueInput(data: string): Promise<void> {
    const operation = this.inputQueue.then(async () => {
      if (!this.closed) await this.processInput(data);
    });
    this.inputQueue = operation.catch((error: unknown) => {
      this.options.notify(`Recap: ${errorMessage(error)}`, "error");
    });
    return operation;
  }

  private async processInput(data: string): Promise<void> {
    if (this.screen.kind === "main") {
      this.updateMainSelection(data);
      const selectedId = MAIN_VALUES[this.mainSelectionIndex];
      if (selectedId === "model" && this.isSettingsConfirmInput(data)) {
        await refreshModelRegistry(
          this.options.registry,
          (message, type) => {
            this.options.notify(message, type);
          },
          this.options.refreshTimeoutMs
        );
      }
    }

    this.pendingMainChange = null;
    this.mainList.handleInput(data);
    const change = this.takePendingMainChange();
    if (change !== null) await this.applyMainChange(change.id, change.value);
  }

  private takePendingMainChange(): { id: string; value: string } | null {
    const change = this.pendingMainChange;
    this.pendingMainChange = null;
    return change;
  }

  private processModelInput(screen: ModelScreen, data: string): void {
    if (this.isSelectListInput(data)) {
      this.resetSelection(screen);
      screen.list.handleInput(data);
      const selected = this.takeSelection(screen);
      if (selected !== null) {
        const entry = screen.visibleEntries.find(
          (candidate) => candidate.item.value === selected.value
        );
        if (entry !== undefined) {
          this.pendingModelSelection = { selection: entry.selection };
          this.finishSubmenu((value) => {
            screen.done(value);
          }, this.modelSelectionValue(entry.selection));
        }
      }
      return;
    }

    screen.input.handleInput(data);
    this.rebuildModelList(screen);
  }

  private processThinkingInput(screen: ChoiceScreen, data: string): void {
    this.resetSelection(screen);
    screen.list.handleInput(data);
    const selected = this.takeSelection(screen);
    if (selected !== null) {
      this.finishSubmenu((value) => {
        screen.done(value);
      }, selected.value);
    }
  }

  private processPresetInput(screen: PresetScreen, data: string): void {
    this.resetSelection(screen);
    screen.list.handleInput(data);
    const selected = this.takeSelection(screen);
    if (selected === null) return;

    if (selected.value === "custom") {
      this.showCustomInput(screen);
      return;
    }

    this.finishSubmenu((value) => {
      screen.done(value);
    }, selected.value);
  }

  private processCustomInput(screen: CustomInputScreen, data: string): void {
    this.resetCustomOutcome(screen);
    screen.input.handleInput(data);
    const outcome = this.takeCustomOutcome(screen);

    if (outcome.cancelled) {
      this.screen = screen.parent;
      this.renderPresetScreen(screen.parent);
      this.syncInputFocus();
      this.options.tui.requestRender();
      return;
    }

    if (outcome.submitted === null) return;

    const value = parseCustomNumeric(outcome.submitted);
    if (value === null) {
      screen.error = "Enter a positive whole number.";
      screen.errorText.setText(this.options.theme.fg("error", screen.error));
      this.options.tui.requestRender();
      return;
    }

    this.finishSubmenu((selectedValue) => {
      screen.parent.done(selectedValue);
    }, String(value));
  }

  private async applyMainChange(id: string, newValue: string): Promise<void> {
    switch (id) {
      case "model":
        if (this.pendingModelSelection !== null) {
          this.draft = applyModelSelection(this.draft, this.pendingModelSelection.selection);
          this.pendingModelSelection = null;
          this.updateMainValues();
        }
        break;
      case "thinking":
        this.draft = applyThinkingSelection(this.draft, newValue as StoredThinkingLevel);
        this.updateMainValues();
        break;
      case "auto":
        this.draft = applyAutoToggle(this.draft, newValue === "On");
        this.updateMainValues();
        break;
      case "save": {
        const result = await performSave(this.draft, {
          ...this.options,
          done: (menuResult) => {
            this.close(menuResult);
          }
        });
        if (!result.ok) this.options.tui.requestRender();
        break;
      }
      case "delay":
      case "messages":
      case "words": {
        const value = parseCustomNumeric(newValue);
        if (value !== null) {
          this.draft = applyNumericValue(this.draft, NUMERIC_ITEM_FIELDS[id], value);
          this.updateMainValues();
        }
        break;
      }
    }
  }

  private buildMainItems(): SettingItem[] {
    return [
      {
        id: "model",
        label: "Recap Model",
        description: "Model used to generate recaps",
        currentValue: this.modelCurrentValue(),
        submenu: (_currentValue, done) => this.buildModelScreen(done)
      },
      {
        id: "thinking",
        label: "Recap Thinking Level",
        description: "Reasoning level for recap generation (clamped to the Recap Model)",
        currentValue: this.draft.thinkingLevel,
        submenu: (_currentValue, done) => this.buildThinkingScreen(done)
      },
      {
        id: "auto",
        label: "Auto Recap",
        description: "Generate a recap automatically after the Idle Delay",
        currentValue: this.draft.autoRecapEnabled ? "On" : "Off",
        values: ["On", "Off"]
      },
      {
        id: "delay",
        label: "Idle Delay",
        description: "Wait time after the last response before generating an automatic recap",
        currentValue: `${this.draft.idleDelaySeconds}s`,
        submenu: (_currentValue, done) => this.buildPresetScreen("idleDelaySeconds", done)
      },
      {
        id: "messages",
        label: "Recent Messages",
        description: "Recent visible messages included when generating a recap",
        currentValue: String(this.draft.recentMessageLimit),
        submenu: (_currentValue, done) => this.buildPresetScreen("recentMessageLimit", done)
      },
      {
        id: "words",
        label: "Maximum Words",
        description: "Maximum number of words in a generated recap",
        currentValue: String(this.draft.wordLimit),
        submenu: (_currentValue, done) => this.buildPresetScreen("wordLimit", done)
      },
      {
        id: "save",
        label: "Save",
        description: "Validate and save these recap settings",
        currentValue: "Save changes",
        values: ["Save changes"]
      }
    ];
  }

  private buildModelScreen(done: (selectedValue?: string) => void): InteractiveContainer {
    const input = new Input();
    const entries: ModelEntry[] = [
      {
        item: { value: "none", label: "None", description: "No Recap Model" },
        selection: null,
        searchText: "none"
      },
      ...this.options.registry.getAvailable().map((model, index) => ({
        item: {
          value: `model:${index}`,
          label: model.id,
          description: `${model.provider} · ${model.name}`
        },
        selection: {
          ref: { provider: model.provider, id: model.id },
          model
        },
        searchText: `${model.id} ${model.provider} ${model.name}`.toLowerCase()
      }))
    ];
    const component = new InteractiveContainer();
    const screen: ModelScreen = {
      kind: "model",
      component,
      input,
      list: new SelectList([], 10, this.selectListTheme),
      entries,
      visibleEntries: entries,
      selected: null,
      done
    };
    component.setInputHandler((data) => {
      this.processModelInput(screen, data);
    });
    this.pendingModelSelection = null;
    this.screen = screen;
    this.rebuildModelList(screen, this.selectedModelEntryValue(entries));
    return component;
  }

  private selectedModelEntryValue(entries: ModelEntry[]): string {
    const draftRef = this.draft.recapModel;
    if (draftRef === null) return "none";

    return (
      entries.find(
        (entry) =>
          entry.selection !== null &&
          entry.selection.ref.provider === draftRef.provider &&
          entry.selection.ref.id === draftRef.id
      )?.item.value ?? "none"
    );
  }

  private rebuildModelList(screen: ModelScreen, preferredValue?: string): void {
    const query = screen.input.getValue().trim().toLowerCase();
    const previousValue = preferredValue ?? screen.list.getSelectedItem()?.value;
    screen.visibleEntries =
      query.length === 0
        ? screen.entries
        : screen.entries.filter((entry) => entry.searchText.includes(query));

    const list = new SelectList(
      screen.visibleEntries.map((entry) => entry.item),
      10,
      this.selectListTheme
    );
    const selectedIndex = screen.visibleEntries.findIndex(
      (entry) => entry.item.value === previousValue
    );
    list.setSelectedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    list.onSelect = (item) => {
      screen.selected = item;
    };
    list.onCancel = () => {
      this.finishSubmenu((value) => {
        screen.done(value);
      });
    };
    screen.list = list;

    this.addSubmenuHeader(
      screen.component,
      "Recap Model",
      "Type to filter by model ID, provider, or name."
    );
    screen.component.addChild(screen.input);
    screen.component.addChild(new Spacer(1));
    screen.component.addChild(list);
    this.addSubmenuHint(screen.component, "Enter to select · Esc to go back");
    screen.input.focused = this.focusedState;
    this.options.tui.requestRender();
  }

  private buildThinkingScreen(done: (selectedValue?: string) => void): InteractiveContainer {
    const model =
      this.draft.recapModel === null
        ? null
        : (this.options.registry.find(this.draft.recapModel.provider, this.draft.recapModel.id) ??
          null);
    const items = thinkingLevelChoices(model).map((level) => ({ value: level, label: level }));
    const list = new SelectList(items, items.length, this.selectListTheme);
    const selectedIndex = items.findIndex((item) => item.value === this.draft.thinkingLevel);
    list.setSelectedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    const component = new InteractiveContainer();
    const screen: ChoiceScreen = {
      kind: "thinking",
      component,
      list,
      items,
      selected: null,
      done
    };
    component.setInputHandler((data) => {
      this.processThinkingInput(screen, data);
    });
    list.onSelect = (item) => {
      screen.selected = item;
    };
    list.onCancel = () => {
      this.finishSubmenu((value) => {
        screen.done(value);
      });
    };
    this.screen = screen;
    this.addSubmenuHeader(
      component,
      "Recap Thinking Level",
      "Select the reasoning level used for recap generation."
    );
    component.addChild(list);
    this.addSubmenuHint(component, "Enter to select · Esc to go back");
    return component;
  }

  private buildPresetScreen(
    field: NumericField,
    done: (selectedValue?: string) => void
  ): InteractiveContainer {
    const items: SelectItem[] = [
      ...FIELD_PRESETS[field].map((value) => ({
        value: String(value),
        label: field === "idleDelaySeconds" ? `${value}s` : String(value)
      })),
      { value: "custom", label: "Custom…" }
    ];
    const list = new SelectList(items, items.length, this.selectListTheme);
    const currentValue = String(this.draft[field]);
    const currentIndex = items.findIndex((item) => item.value === currentValue);
    list.setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
    const component = new InteractiveContainer();
    const screen: PresetScreen = {
      kind: "preset",
      component,
      list,
      items,
      field,
      selected: null,
      done
    };
    component.setInputHandler((data) => {
      if (this.screen.kind === "customInput") {
        this.processCustomInput(this.screen, data);
      } else {
        this.processPresetInput(screen, data);
      }
    });
    list.onSelect = (item) => {
      screen.selected = item;
    };
    list.onCancel = () => {
      this.finishSubmenu((value) => {
        screen.done(value);
      });
    };
    this.screen = screen;
    this.renderPresetScreen(screen);
    return component;
  }

  private showCustomInput(parent: PresetScreen): void {
    const input = new Input();
    const errorText = new Text("");
    const screen: CustomInputScreen = {
      kind: "customInput",
      component: parent.component,
      input,
      errorText,
      field: parent.field,
      parent,
      submitted: null,
      cancelled: false,
      error: null
    };
    input.onSubmit = (value) => {
      screen.submitted = value;
    };
    input.onEscape = () => {
      screen.cancelled = true;
    };
    this.screen = screen;
    this.addSubmenuHeader(
      parent.component,
      `Custom ${FIELD_LABELS[parent.field]}`,
      "Enter a positive whole number."
    );
    parent.component.addChild(input);
    parent.component.addChild(errorText);
    this.addSubmenuHint(parent.component, "Enter to use · Esc to go back");
    this.syncInputFocus();
    this.options.tui.requestRender();
  }

  private isSelectListInput(data: string): boolean {
    return (
      this.options.keybindings.matches(data, "tui.select.up") ||
      this.options.keybindings.matches(data, "tui.select.down") ||
      this.options.keybindings.matches(data, "tui.select.confirm") ||
      this.options.keybindings.matches(data, "tui.select.cancel")
    );
  }

  private resetSelection(screen: SelectableScreen): void {
    screen.selected = null;
  }

  private takeSelection(screen: SelectableScreen): SelectItem | null {
    const selected = screen.selected;
    screen.selected = null;
    return selected;
  }

  private resetCustomOutcome(screen: CustomInputScreen): void {
    screen.submitted = null;
    screen.cancelled = false;
  }

  private takeCustomOutcome(screen: CustomInputScreen): {
    submitted: string | null;
    cancelled: boolean;
  } {
    return { submitted: screen.submitted, cancelled: screen.cancelled };
  }

  private updateMainSelection(data: string): void {
    if (this.options.keybindings.matches(data, "tui.select.up")) {
      this.mainSelectionIndex =
        this.mainSelectionIndex === 0 ? MAIN_VALUES.length - 1 : this.mainSelectionIndex - 1;
    } else if (this.options.keybindings.matches(data, "tui.select.down")) {
      this.mainSelectionIndex =
        this.mainSelectionIndex === MAIN_VALUES.length - 1 ? 0 : this.mainSelectionIndex + 1;
    }
  }

  private isSettingsConfirmInput(data: string): boolean {
    return this.options.keybindings.matches(data, "tui.select.confirm") || data === " ";
  }

  private finishSubmenu(done: (selectedValue?: string) => void, selectedValue?: string): void {
    this.screen = { kind: "main" };
    this.syncInputFocus();
    done(selectedValue);
    this.options.tui.requestRender();
  }

  private modelCurrentValue(): string {
    return this.draft.recapModel === null
      ? "(none)"
      : `${this.draft.recapModel.provider}/${this.draft.recapModel.id}`;
  }

  private modelSelectionValue(selection: { ref: RecapModelRef; model: Model<Api> } | null): string {
    return selection === null ? "(none)" : `${selection.ref.provider}/${selection.ref.id}`;
  }

  private updateMainValues(): void {
    this.mainList.updateValue("model", this.modelCurrentValue());
    this.mainList.updateValue("thinking", this.draft.thinkingLevel);
    this.mainList.updateValue("auto", this.draft.autoRecapEnabled ? "On" : "Off");
    this.mainList.updateValue("delay", `${this.draft.idleDelaySeconds}s`);
    this.mainList.updateValue("messages", String(this.draft.recentMessageLimit));
    this.mainList.updateValue("words", String(this.draft.wordLimit));
    this.options.tui.requestRender();
  }

  private addSubmenuHeader(
    component: InteractiveContainer,
    title: string,
    description?: string
  ): void {
    component.clear();
    component.addChild(
      new Text(this.options.theme.bold(this.options.theme.fg("accent", title)), 0, 0)
    );
    if (description !== undefined) {
      component.addChild(new Spacer(1));
      component.addChild(new Text(this.options.theme.fg("muted", description), 0, 0));
    }
    component.addChild(new Spacer(1));
  }

  private addSubmenuHint(component: InteractiveContainer, hint: string): void {
    component.addChild(new Spacer(1));
    component.addChild(new Text(this.options.theme.fg("dim", `  ${hint}`), 0, 0));
  }

  private renderPresetScreen(screen: PresetScreen): void {
    this.addSubmenuHeader(
      screen.component,
      FIELD_LABELS[screen.field],
      "Select a preset or enter a custom positive whole number."
    );
    screen.component.addChild(screen.list);
    this.addSubmenuHint(screen.component, "Enter to select · Esc to go back");
  }

  private screenList(screen: SettingsScreen): SelectList | null {
    switch (screen.kind) {
      case "main":
        return null;
      case "model":
      case "thinking":
      case "preset":
        return screen.list;
      case "customInput":
        return null;
    }
  }

  private screenItems(screen: SettingsScreen): { label: string }[] {
    switch (screen.kind) {
      case "main":
        return this.mainItems;
      case "thinking":
      case "preset":
        return screen.items;
      case "model":
        return screen.visibleEntries.map((entry) => entry.item);
      case "customInput":
        return [];
    }
  }

  private syncInputFocus(): void {
    if (this.screen.kind === "model" || this.screen.kind === "customInput") {
      this.screen.input.focused = this.focusedState;
    }
  }

  private close(result: MenuResult): void {
    if (this.closed) return;
    this.closed = true;
    this.options.done(result);
  }
}

export async function createRecapSettingsController(
  options: CreateRecapSettingsControllerOptions
): Promise<RecapSettingsController> {
  await refreshModelRegistry(
    options.registry,
    (message, type) => {
      options.notify(message, type);
    },
    options.refreshTimeoutMs
  );
  return new RecapSettingsController(options);
}

export async function openRecapSettingsMenu(deps: RecapSettingsMenuDeps): Promise<void> {
  const initialConfig = deps.loadConfig();
  await deps.ui.custom<MenuResult>(
    async (tui, theme, keybindings, done) =>
      createRecapSettingsController({
        tui,
        theme,
        keybindings,
        initialConfig,
        registry: deps.registry,
        saveConfig: (config) => {
          deps.saveConfig(config);
        },
        onSaved: (config) => {
          deps.onSaved(config);
        },
        notify: (message, type) => {
          deps.ui.notify(message, type);
        },
        refreshTimeoutMs: deps.refreshTimeoutMs,
        done
      }),
    {
      overlay: true,
      overlayOptions: {
        width: "60%",
        minWidth: 48,
        maxHeight: "70%",
        margin: 1
      }
    }
  );
}
