import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Input,
  SelectList,
  Text,
  type KeybindingsManager,
  type SelectItem,
  type SelectListTheme,
  type TUI
} from "@earendil-works/pi-tui";
import {
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
}

export interface RecapSettingsMenuDeps {
  ui: ExtensionContext["ui"];
  registry: RecapModelRegistry;
  loadConfig(): RecapConfig;
  saveConfig(config: RecapConfig): void;
  onSaved(config: RecapConfig): void;
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
  theme: Pick<Theme, "fg">;
  keybindings: KeybindingsManager;
  initialConfig: RecapConfig;
}

interface MainScreen {
  kind: "main";
  component: SelectList;
  items: SelectItem[];
  selected: SelectItem | null;
}

interface ModelEntry {
  item: SelectItem;
  selection: { ref: RecapModelRef; model: Model<Api> } | null;
  searchText: string;
}

interface ModelScreen {
  kind: "model";
  component: Container;
  input: Input;
  list: SelectList;
  entries: ModelEntry[];
  visibleEntries: ModelEntry[];
  selected: SelectItem | null;
}

interface ChoiceScreen {
  kind: "thinking" | "auto";
  component: Container;
  list: SelectList;
  items: SelectItem[];
  selected: SelectItem | null;
}

interface PresetScreen {
  kind: "preset";
  component: Container;
  list: SelectList;
  items: SelectItem[];
  field: NumericField;
  selected: SelectItem | null;
}

interface CustomInputScreen {
  kind: "customInput";
  component: Container;
  input: Input;
  errorText: Text;
  field: NumericField;
  submitted: string | null;
  cancelled: boolean;
  error: string | null;
}

type SettingsScreen = MainScreen | ModelScreen | ChoiceScreen | PresetScreen | CustomInputScreen;

type SelectableScreen = MainScreen | ModelScreen | ChoiceScreen | PresetScreen;

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

function copyConfig(config: RecapConfig): RecapConfig {
  return {
    ...config,
    recapModel:
      config.recapModel === null
        ? null
        : { provider: config.recapModel.provider, id: config.recapModel.id }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
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
  await deps.registry.refresh();

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
      `Recap: thinking level clamped to ${config.thinkingLevel} for ${config.recapModel.provider}/${config.recapModel.id}.`,
      "info"
    );
  }

  deps.done("saved");
  return { ok: true, config, clampedFrom };
}

export class RecapSettingsController extends Container {
  private readonly options: CreateRecapSettingsControllerOptions;
  private readonly selectListTheme: SelectListTheme;
  private readonly screens: SettingsScreen[];
  private draft: SettingsDraft;
  private mainSelectionIndex = 0;
  private focusedState = false;
  private closed = false;
  private inputQueue: Promise<void> = Promise.resolve();

  constructor(options: CreateRecapSettingsControllerOptions) {
    super();
    this.options = options;
    this.selectListTheme = getSelectListTheme();
    this.draft = copyConfig(options.initialConfig);
    this.screens = [this.buildMainScreen()];
    this.showCurrentScreen();
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
    const screen = this.currentScreen();
    const list = this.screenList(screen);
    return {
      screen: screen.kind,
      draft: copyConfig(this.draft),
      options: this.screenItems(screen).map((item) => item.label),
      selectedValue: list?.getSelectedItem()?.value ?? null,
      filter: screen.kind === "model" ? screen.input.getValue() : null,
      error: screen.kind === "customInput" ? screen.error : null
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
    const screen = this.currentScreen();
    switch (screen.kind) {
      case "main":
        await this.processMainInput(screen, data);
        break;
      case "model":
        this.processModelInput(screen, data);
        break;
      case "thinking":
        this.processThinkingInput(screen, data);
        break;
      case "auto":
        this.processAutoInput(screen, data);
        break;
      case "preset":
        this.processPresetInput(screen, data);
        break;
      case "customInput":
        this.processCustomInput(screen, data);
        break;
    }
  }

  private async processMainInput(screen: MainScreen, data: string): Promise<void> {
    this.resetSelection(screen);
    screen.component.handleInput(data);
    const selected = this.takeSelection(screen);
    if (selected !== null) {
      await this.activateMainItem(selected.value);
    }
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
          this.draft = applyModelSelection(this.draft, entry.selection);
          this.returnToMain();
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
      this.draft = applyThinkingSelection(this.draft, selected.value as StoredThinkingLevel);
      this.returnToMain();
    }
  }

  private processAutoInput(screen: ChoiceScreen, data: string): void {
    this.resetSelection(screen);
    screen.list.handleInput(data);
    const selected = this.takeSelection(screen);
    if (selected !== null) {
      this.draft = applyAutoToggle(this.draft, selected.value === "on");
      this.returnToMain();
    }
  }

  private processPresetInput(screen: PresetScreen, data: string): void {
    this.resetSelection(screen);
    screen.list.handleInput(data);
    const selected = this.takeSelection(screen);
    if (selected === null) return;

    if (selected.value === "custom") {
      this.pushScreen(this.buildCustomInputScreen(screen.field));
      return;
    }

    const value = Number(selected.value);
    this.draft = applyNumericValue(this.draft, screen.field, value);
    this.returnToMain();
  }

  private processCustomInput(screen: CustomInputScreen, data: string): void {
    this.resetCustomOutcome(screen);
    screen.input.handleInput(data);
    const outcome = this.takeCustomOutcome(screen);

    if (outcome.cancelled) {
      this.popScreen();
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

    this.draft = applyNumericValue(this.draft, screen.field, value);
    this.returnToMain();
  }

  private async activateMainItem(value: string): Promise<void> {
    switch (value) {
      case "model":
        await this.options.registry.refresh();
        this.pushScreen(this.buildModelScreen());
        break;
      case "thinking":
        this.pushScreen(this.buildThinkingScreen());
        break;
      case "auto":
        this.pushScreen(this.buildAutoScreen());
        break;
      case "delay":
        this.pushScreen(this.buildPresetScreen("idleDelaySeconds"));
        break;
      case "messages":
        this.pushScreen(this.buildPresetScreen("recentMessageLimit"));
        break;
      case "words":
        this.pushScreen(this.buildPresetScreen("wordLimit"));
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
    }
  }

  private buildMainScreen(): MainScreen {
    const items = this.mainItems();
    const list = new SelectList(items, items.length, this.selectListTheme);
    list.setSelectedIndex(this.mainSelectionIndex);
    const screen: MainScreen = {
      kind: "main",
      component: list,
      items,
      selected: null
    };
    list.onSelectionChange = (item) => {
      const index = MAIN_VALUES.indexOf(item.value as (typeof MAIN_VALUES)[number]);
      if (index >= 0) this.mainSelectionIndex = index;
    };
    list.onSelect = (item) => {
      screen.selected = item;
    };
    list.onCancel = () => {
      this.close("cancelled");
    };
    return screen;
  }

  private mainItems(): SelectItem[] {
    const recapModel =
      this.draft.recapModel === null
        ? "(none)"
        : `${this.draft.recapModel.provider}/${this.draft.recapModel.id}`;
    return [
      { value: "model", label: `Recap Model: ${recapModel}` },
      { value: "thinking", label: `Recap Thinking Level: ${this.draft.thinkingLevel}` },
      { value: "auto", label: `Auto Recap: ${this.draft.autoRecapEnabled ? "On" : "Off"}` },
      { value: "delay", label: `Idle Delay: ${this.draft.idleDelaySeconds}s` },
      { value: "messages", label: `Recent Messages: ${this.draft.recentMessageLimit}` },
      { value: "words", label: `Maximum Words: ${this.draft.wordLimit}` },
      { value: "save", label: "Save" }
    ];
  }

  private buildModelScreen(): ModelScreen {
    const component = new Container();
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
    const screen: ModelScreen = {
      kind: "model",
      component,
      input,
      list: new SelectList([], 10, this.selectListTheme),
      entries,
      visibleEntries: entries,
      selected: null
    };
    input.onEscape = () => {
      this.popScreen();
    };
    this.rebuildModelList(screen, this.selectedModelEntryValue(entries));
    return screen;
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
      this.popScreen();
    };
    screen.list = list;

    screen.component.clear();
    screen.component.addChild(new Text("Recap Model"));
    screen.component.addChild(screen.input);
    screen.component.addChild(list);
    screen.input.focused = this.focusedState;
    this.options.tui.requestRender();
  }

  private buildThinkingScreen(): ChoiceScreen {
    const model =
      this.draft.recapModel === null
        ? null
        : (this.options.registry.find(this.draft.recapModel.provider, this.draft.recapModel.id) ??
          null);
    const items = thinkingLevelChoices(model).map((level) => ({ value: level, label: level }));
    const list = new SelectList(items, items.length, this.selectListTheme);
    const selectedIndex = items.findIndex((item) => item.value === this.draft.thinkingLevel);
    list.setSelectedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    const component = new Container();
    component.addChild(new Text("Recap Thinking Level"));
    component.addChild(list);
    const screen: ChoiceScreen = {
      kind: "thinking",
      component,
      list,
      items,
      selected: null
    };
    list.onSelect = (item) => {
      screen.selected = item;
    };
    list.onCancel = () => {
      this.popScreen();
    };
    return screen;
  }

  private buildAutoScreen(): ChoiceScreen {
    const items: SelectItem[] = [
      { value: "on", label: "On" },
      { value: "off", label: "Off" }
    ];
    const list = new SelectList(items, items.length, this.selectListTheme);
    list.setSelectedIndex(this.draft.autoRecapEnabled ? 0 : 1);
    const component = new Container();
    component.addChild(new Text("Auto Recap"));
    component.addChild(list);
    const screen: ChoiceScreen = {
      kind: "auto",
      component,
      list,
      items,
      selected: null
    };
    list.onSelect = (item) => {
      screen.selected = item;
    };
    list.onCancel = () => {
      this.popScreen();
    };
    return screen;
  }

  private buildPresetScreen(field: NumericField): PresetScreen {
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
    const component = new Container();
    component.addChild(new Text(FIELD_LABELS[field]));
    component.addChild(list);
    const screen: PresetScreen = {
      kind: "preset",
      component,
      list,
      items,
      field,
      selected: null
    };
    list.onSelect = (item) => {
      screen.selected = item;
    };
    list.onCancel = () => {
      this.popScreen();
    };
    return screen;
  }

  private buildCustomInputScreen(field: NumericField): CustomInputScreen {
    const input = new Input();
    const errorText = new Text("");
    const component = new Container();
    component.addChild(new Text(`Custom ${FIELD_LABELS[field]}`));
    component.addChild(input);
    component.addChild(errorText);
    const screen: CustomInputScreen = {
      kind: "customInput",
      component,
      input,
      errorText,
      field,
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
    return screen;
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

  private currentScreen(): SettingsScreen {
    return this.screens[this.screens.length - 1];
  }

  private screenList(screen: SettingsScreen): SelectList | null {
    switch (screen.kind) {
      case "main":
        return screen.component;
      case "model":
      case "thinking":
      case "auto":
      case "preset":
        return screen.list;
      case "customInput":
        return null;
    }
  }

  private screenItems(screen: SettingsScreen): SelectItem[] {
    switch (screen.kind) {
      case "main":
      case "thinking":
      case "auto":
      case "preset":
        return screen.items;
      case "model":
        return screen.visibleEntries.map((entry) => entry.item);
      case "customInput":
        return [];
    }
  }

  private pushScreen(screen: SettingsScreen): void {
    this.screens.push(screen);
    this.showCurrentScreen();
  }

  private popScreen(): void {
    if (this.screens.length === 1) {
      this.close("cancelled");
      return;
    }
    this.screens.pop();
    this.showCurrentScreen();
  }

  private returnToMain(): void {
    this.screens.splice(0, this.screens.length, this.buildMainScreen());
    this.showCurrentScreen();
  }

  private showCurrentScreen(): void {
    this.clear();
    this.addChild(this.currentScreen().component);
    this.syncInputFocus();
    this.options.tui.requestRender();
  }

  private syncInputFocus(): void {
    const screen = this.currentScreen();
    if (screen.kind === "model" || screen.kind === "customInput") {
      screen.input.focused = this.focusedState;
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
  await options.registry.refresh();
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
        done
      }),
    {
      overlay: true,
      overlayOptions: { width: "70%", maxHeight: "80%" }
    }
  );
}
