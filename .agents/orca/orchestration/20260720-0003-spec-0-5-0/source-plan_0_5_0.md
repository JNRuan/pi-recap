# pi-recap 0.5.0 Implementation Plan

This plan implements [spec_0_5_0.md](../specs/spec_0_5_0.md). It is written for a follow-on coding agent. The spec is authoritative; where this plan and the spec disagree, follow the spec and note the discrepancy in your summary.

## Before starting

1. Read, in order:
   - `AGENTS.md` (conventions: zero `any`, strictTypeChecked ESLint, bun scripts, pnpm deps)
   - `CONTEXT.md` (domain language; user-facing text must say "Recap Model", "Recap Thinking Level", "Auto Recap", "Idle Delay"; never "effort" or "interval")
   - `docs/specs/spec_0_5_0.md`
   - `src/index.ts`, `src/config.ts`, `src/conversation.ts`, `scripts/test-extract.ts`
2. Confirm the current implementation shape:
   - `src/config.ts` holds the legacy schema `{provider, model, effort, intervalSeconds, wordLimit, recentMessageLimit}` and merges project settings over global in `loadSettingsPiRecap`.
   - `src/index.ts` renders the loading widget before the model/auth gates run, warns at `session_start` when no model is configured, registers four `--recap-*` flags, and handles subcommands `config|on|off|model|interval|messages|recent`.
   - `parseRecapModel` (`src/config.ts:70`) rejects model ids containing more than one slash; the spec now requires first-slash-only splitting.
3. Environment facts:
   - Installed Pi packages are 0.74.0; the spec baseline 0.80.10 is published on npm for all three packages. The machine's npm/pnpm goes through a safe-chain wrapper that hides packages younger than a minimum age; if the upgrade cannot resolve 0.80.10, use `--safe-chain-skip-minimum-package-age` or invoke the unwrapped tool.
   - `package.json` declares the Pi packages as peerDependencies `"*"`; pnpm `autoInstallPeers` materializes them, pinned by `pnpm-lock.yaml` (currently 0.74.0).

## M0: Runtime baseline and API verification

**Goal:** upgrade to Pi >= 0.80.10, pin the peer ranges, and confirm the real API surface before writing feature code.

1. Set the three peerDependency ranges in `package.json` to `">=0.80.10"` and upgrade:

   ```bash
   pnpm up "@earendil-works/pi-ai@0.80.10" "@earendil-works/pi-coding-agent@0.80.10" "@earendil-works/pi-tui@0.80.10"
   ```

2. **API verification (mandatory, before coding):** read the installed `.d.ts` files under `node_modules/@earendil-works/` and confirm or adapt. The spec was written against 0.80.10 but this plan's signatures were verified against 0.74.0; check each:
   - `completeSimple()` location. Spec: exported from `@earendil-works/pi-ai/compat`. At 0.74.0 it is exported from the pi-ai root. Import from wherever it actually lives.
   - `SimpleStreamOptions.reasoning`. Spec: an enabled `ThinkingLevel`; `off` is represented by omitting the option. At 0.74.0: `ThinkingLevel = "minimal"|"low"|"medium"|"high"|"xhigh"`, `ModelThinkingLevel = "off" | ThinkingLevel`. Spec says 0.80.10 adds `max`; confirm and use the actual union. pi-recap's own stored union must include `max` per spec either way (`clampThinkingLevel` handles models that do not support it).
   - `getSupportedThinkingLevels(model)` and `clampThinkingLevel(model, level)` exports (pi-ai root at 0.74.0). Non-reasoning model returns `["off"]`; clamp scans up then down for the nearest supported level.
   - `ctx.modelRegistry.getApiKeyAndHeaders(model)` return shape. At 0.74.0: `{ok: true; apiKey?; headers?} | {ok: false; error}` (no env field). Spec says pass "API key, headers, and environment"; pass through whatever credential fields the 0.80.10 result actually exposes.
   - `ctx.ui.custom<T>(factory, {overlay?, overlayOptions?})`, `ctx.ui.select/confirm/input/notify/setWidget`, `ctx.hasUI`.
   - pi-tui `SelectList` (ctor `(items, maxVisible, theme, layout?)`, `onSelect`, `onCancel`, `setFilter`, and whether items can be replaced after construction), `Input` (value getter name, `onSubmit`, `onEscape`), `Container`, `Text`. `getSelectListTheme()` export from pi-coding-agent.
   - `VERSION` export from pi-coding-agent.
   - Record any deviations as comments in your working notes and adapt; the spec's intent is fixed: model-agnostic simple completion path, `reasoning: <level>` for enabled levels, omitted for `off`, letting Pi apply each model's `thinkingLevelMap`.
3. Add `isVersionAtLeast(actual, required)` (pure dotted-numeric compare, prerelease-tolerant) to `src/config.ts` with `export const REQUIRED_PI_VERSION = "0.80.10"`.
4. Add `scripts/test-baseline.ts` (assertion-based, bun): peer ranges are `">=0.80.10"` for all three packages (read `package.json`); `isVersionAtLeast` matrix (`0.80.9` false, `0.80.10`/`0.81.0`/`1.0.0` true); import `VERSION` from the installed pi-coding-agent and assert it meets the baseline (this enforces that the lockfile really was upgraded).

**Done when:** install is clean and `bun run scripts/test-baseline.ts` passes. `pnpm check` may fail until M3 because the old `index.ts` compiles against new types; that is expected.

## Module layout (target)

```
src/index.ts          Lifecycle events, widget/spinner, idle timer, command dispatch (side-effectful glue)
src/config.ts         Rewritten: types, defaults, validation + legacy migration, global-only load,
                      normalized atomic save, version baseline check
src/commands.ts       New: pure parseRecapCommand(args) -> discriminated union + usage strings
src/generate.ts       New: prompt builder, output normalization, sentence-aware trim,
                      shared preflight gates, generateRecapText (DI'd completion fn)
src/settings-menu.ts  New: ctx.ui.custom() settings menu + exported pure draft reducers + performSave()
src/conversation.ts   Unchanged
```

The split follows testability seams: everything the spec's verification list needs to assert lives in pure functions (`config`, `commands`, `generate` pure parts, menu reducers); `index.ts` shrinks to wiring.

## M1: Config and command modules

**Goal:** new schema, migration, global-only loading, normalized saves, and the canonical command grammar, all as pure testable functions.

### src/config.ts rewrite

Types:

```ts
export type StoredThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const THINKING_LEVELS: readonly StoredThinkingLevel[] = [...];

export interface RecapModelRef { provider: string; id: string; }

export interface RecapConfig {
  recapModel: RecapModelRef | null;   // default null
  thinkingLevel: StoredThinkingLevel; // default "low"
  autoRecapEnabled: boolean;          // default true
  idleDelaySeconds: number;           // default 300
  wordLimit: number;                  // default 100
  recentMessageLimit: number;         // default 20
}
```

`resolveRecapConfig(rawPiRecap: unknown): RecapConfig` resolves each field independently per the spec's migration rules.

`recapModel` truth table (legacy keys `provider`, `model`):

| `recapModel` key                                    | legacy `provider`/`model`      | result                                                                                                                |
| --------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| valid object, non-empty trimmed `provider` and `id` | anything                       | that ref, trimmed                                                                                                     |
| explicitly `null`                                   | anything                       | `null` (explicit null is a valid value and blocks legacy inference; the spec infers only when `recapModel` is absent) |
| present but invalid                                 | anything                       | `null`, no legacy inference                                                                                           |
| absent                                              | both non-empty trimmed strings | `{provider, id: model}`                                                                                               |
| absent                                              | partial / empty / invalid      | `null`                                                                                                                |

`autoRecapEnabled` truth table (legacy key `intervalSeconds`):

| `autoRecapEnabled` | legacy `intervalSeconds` | result           |
| ------------------ | ------------------------ | ---------------- |
| boolean            | anything                 | that boolean     |
| absent/invalid     | `0`                      | `false`          |
| absent/invalid     | positive safe integer    | `true`           |
| absent/invalid     | missing/invalid          | `true` (default) |

`idleDelaySeconds` truth table:

| `idleDelaySeconds`                     | legacy `intervalSeconds` | result       |
| -------------------------------------- | ------------------------ | ------------ |
| positive safe integer                  | anything                 | that value   |
| absent/invalid (incl. 0 and negatives) | positive safe integer    | legacy value |
| absent/invalid                         | `0`/missing/invalid      | `300`        |

So legacy `{intervalSeconds: 0}` becomes `{autoRecapEnabled: false, idleDelaySeconds: 300}` and `{intervalSeconds: 600}` becomes `{autoRecapEnabled: true, idleDelaySeconds: 600}`.

`thinkingLevel`: member of `THINKING_LEVELS` or default `"low"`. The legacy `effort` key is never read (spec is explicit). `wordLimit`/`recentMessageLimit`: positive safe integers or defaults.

Loading, global only:

```ts
export function loadRecapConfig(source: { getGlobalSettings(): unknown }): RecapConfig;
```

Reads only `getGlobalSettings().piRecap`. Delete the project-settings merge entirely; project `piRecap` is silently ignored. Callers use `SettingsManager.create(ctx.cwd)` fresh per load, as today. The narrow structural parameter enables the "project settings excluded" test with a fake.

Saving, one normalized writer for every path:

```ts
export function buildNormalizedPiRecap(config: RecapConfig): Record<string, unknown>; // exactly the 6 new-schema keys
export function saveRecapConfig(config: RecapConfig, agentDir?: string): void; // defaults to getAgentDir()
```

Keep the current read-modify-write + tmp-file + `renameSync` atomic pattern on `<agentDir>/settings.json`, preserving all other top-level keys, but replace `settings.piRecap` wholesale with `buildNormalizedPiRecap(config)`, which by construction removes `provider`, `model`, `effort`, `intervalSeconds`, and any unknown keys.

Decision (record in code review notes, not comments): typed setter commands also write the full normalized config, not just menu Save. The spec mandates normalization on Save and says setters "persist immediately"; since migration is deterministic per field, load, apply one change, write full loses nothing, and spec invariants hold by construction (e.g. `/recap delay 600` cannot change whether Auto Recap is enabled). One writer, one code path.

### src/commands.ts (new)

```ts
export type RecapCommand =
  | { kind: "refresh" } // bare /recap, empty/whitespace args only
  | { kind: "settings" }
  | { kind: "config" }
  | { kind: "auto"; enabled: boolean }
  | { kind: "model"; model: RecapModelRef | null } // null == "none"
  | { kind: "thinking"; level: StoredThinkingLevel }
  | { kind: "delay"; seconds: number }
  | { kind: "messages"; count: number }
  | { kind: "words"; count: number }
  | { kind: "usage"; message: string } // recognized head, missing/invalid value
  | { kind: "unknown"; message: string }; // unrecognized head, incl. removed legacy commands

export function parseRecapCommand(args: string): RecapCommand;
export function parseModelArg(raw: string): RecapModelRef | null; // FIRST-slash split
export function parsePositiveSafeInt(raw: string): number | null;
```

Rules:

- Empty/whitespace args → `refresh`. Recognized heads: `settings`, `config`, `auto`, `model`, `thinking`, `delay`, `messages`, `words`.
- `parseModelArg` splits on the first slash only, so `openrouter/deepseek/deepseek-chat-v3` yields `{provider: "openrouter", id: "deepseek/deepseek-chat-v3"}`. This is a deliberate behavior change from the current `parseRecapModel`, which rejects extra slashes; delete that rejection. Both halves trimmed and non-empty. The literal `none` maps to `{kind: "model", model: null}`.
- Missing or invalid values → `usage` with exact usage lines (`Usage: /recap auto on|off`, `Usage: /recap model provider/model|none`, `Usage: /recap thinking off|minimal|low|medium|high|xhigh|max`, `Usage: /recap delay <seconds>`, `Usage: /recap messages <count>`, `Usage: /recap words <count>`). Setters without values never open menus (spec rule).
- Removed legacy heads `on`, `off`, `interval`, `recent`, and any other unrecognized head → `unknown` with the message `Recap: unknown subcommand "<head>". Available: settings, auto, model, thinking, delay, messages, words, config.` For the four legacy names append a migration hint (`on`/`off` → `auto on|off`, `interval` → `delay`, `recent` → `messages`).
- Unknown text does not fall through to refresh; only truly empty args refresh. This stops typos from silently firing a generation.

### Tests for M1

`scripts/test-config.ts`: all seven thinking levels accepted and junk falls back to `low`; `effort` ignored; the three migration truth tables including partial migration; Idle Delay preserved while auto disabled; `buildNormalizedPiRecap` has exactly six keys and no obsolete ones; global-only loading via a fake `{getGlobalSettings, getProjectSettings}` where project values must have no effect; `saveRecapConfig` round-trip against a temp dir (obsolete keys removed, sibling top-level settings preserved).

`scripts/test-commands.ts`: canonical parsing of all forms; usage results on missing values; first-slash model parsing with multi-slash ids; `none`; `on`/`off`/`interval`/`recent` produce `unknown`; bare and whitespace args produce `refresh`; garbage produces `unknown`, not `refresh`.

**Done when:** both bun scripts pass and `eslint src/config.ts src/commands.ts` is clean.

## M2: Generation module

**Goal:** revised prompt, output enforcement, and the shared preflight gates as pure/DI-testable functions in `src/generate.ts`.

### Prompt

`buildRecapSystemPrompt(wordLimit: number): string` emits the spec's "Revised prompt" contract verbatim with `{wordLimit}` interpolated. Delete the old 50-word prompt constant from `index.ts`.

### Output enforcement

```ts
export function normalizeRecapText(raw: string): string; // trim; strip /^Recap:\s*/i; trim again
export function enforceWordLimit(text: string, wordLimit: number): string;
```

`enforceWordLimit` algorithm:

1. Split on `/\s+/`; if word count <= limit, return trimmed text unchanged (no ellipsis).
2. Find sentence boundaries with a regex like `/[.!?…]+["')\]]*(?=\s|$)/g` (terminator run plus optional closing quote/bracket, followed by whitespace or end). The lookahead keeps `0.5.0` and mid-token dots intact; `e.g. foo` still splitting is an accepted heuristic imperfection.
3. Iterate matches in order; for each prefix ending at a boundary, count its words; keep the longest prefix that fits; stop once a prefix exceeds the limit.
4. If a fitting sentence prefix exists, return it plus `…`; otherwise return the first `wordLimit` words joined plus `…`.

The ellipsis (U+2026) is appended without a preceding space so it never adds a word, satisfying the spec's "without causing the word count to exceed the configured maximum" unconditionally. Never retry generation for length.

### Shared preflight

```ts
export type RecapTrigger = "manual" | "auto" | "startup" | "compaction";

export interface PreflightDeps {
  registry: { refresh(): void; find(p: string, id: string): Model<Api> | undefined;
              getApiKeyAndHeaders(m: Model<Api>): Promise<...> };  // structural, fakeable
  notify(message: string, type: "info" | "warning" | "error"): void;
  saveConfig(config: RecapConfig): void;
}

export type PreflightResult =
  | { ok: true; model: Model<Api>; auth: ...; effectiveLevel: ModelThinkingLevel }
  | { ok: false };

export async function preflightRecap(config, trigger, deps): Promise<PreflightResult>
```

Gate order and notification matrix:

| #   | Gate                                           | manual                                                                                        | auto / startup / compaction |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | `recapModel === null`                          | warn: "Recap: no Recap Model configured. Run /recap settings or /recap model provider/model." | silent skip                 |
| 2   | `registry.refresh()`; `find()` misses          | warn (model not found)                                                                        | warn                        |
| 3   | auth resolution fails                          | warn                                                                                          | warn                        |
| 4   | `clampThinkingLevel` differs from stored level | persist clamped level + info notify                                                           | same                        |

Gates 2 and 3 warn on every path per the spec ("Manual and automatic generation report configured models that are missing, unavailable, or unauthenticated"). Gate 1 is the only trigger-sensitive one; the spec names startup and Auto Recap as silent, and compaction is grouped with them (decision to record). Gate 4 never fails preflight; it persists and notifies only when the effective level differs from the stored one, so after one persistence the next tick compares equal and stays quiet (no per-tick spam). If the save throws, notify the error but continue generating with the effective level.

### runRecap call sequence (implemented in M3, designed here)

1. `alive` / `pending` / leaf-dedup checks (dedup applies to `auto` only; `manual`, `startup`, `compaction` force).
2. `loadRecapConfig`.
3. `auto` only: `autoRecapEnabled === false` → silent return (manual ignores the toggle and the Idle Delay).
4. `preflightRecap`; on `{ok: false}` return with no widget change, previous recap untouched, `lastRecapEntryId` untouched (spec: a failed gate does not show a loading widget, replace the previous recap, or mark the entry recapped).
5. Build conversation text; if empty: `manual` gets info "Recap: nothing to recap yet", other triggers return silently. Still no widget. (This moves the check before the spinner and stops the current per-tick notify on empty sessions.)
6. Only now render the loading spinner widget.
7. `generateRecapText`, then the existing generation/leaf/alive post-checks, `normalizeRecapText`, empty-response warning, `enforceWordLimit`, store `lastRecapText`/`lastRecapEntryId`, final render.

### Generation call

`generateRecapText` calls the simple completion path (import location confirmed in M0) with `systemPrompt: buildRecapSystemPrompt(wordLimit)`, the conversation text as a single user message, `apiKey`/`headers` (plus env if the 0.80.10 auth result exposes it), and `...(effectiveLevel !== "off" ? { reasoning: effectiveLevel } : {})`. Omitting `reasoning` for `off` is the exact behavior a test asserts via a capturing fake completion fn (accept the fn through a `deps` parameter defaulting to the real import).

### Tests for M2

`scripts/test-trim.ts`: normalization (Recap: prefix strip, whitespace); sentence-prefix trim; fallback word trim when no sentence fits; at-limit text untouched; ellipsis never adds a word; version numbers survive; multi-terminator `?!`; no terminators at all.

`scripts/test-prompt.ts`: dynamic word limit interpolated; the string "50 words" absent; newest-explicit-state instructions present ("Prioritize the newest explicit information", "supersedes").

`scripts/test-gates.ts`: with fake registry/notify/save: null-model manual warn vs auto/startup/compaction silence; missing model and auth failure warn on both manual and auto; clamp persists and notifies exactly once (second run with the persisted config performs no save and no notify); `generateRecapText` with a capturing fake: `reasoning` absent for `off`, present otherwise; auth passed through.

**Done when:** the three bun scripts pass.

## M3: index.ts rewrite (first fully green tree)

**Goal:** wire the new modules into the extension lifecycle; delete everything the spec removes.

- Baseline guard at the top of `piRecap(pi)`: if `!isVersionAtLeast(VERSION, REQUIRED_PI_VERSION)`, register only a `session_start` handler notifying `"pi-recap requires Pi >= 0.80.10 (found <VERSION>); recap is disabled."` as error and skip all other registration.
- Delete all four `pi.registerFlag("recap-*")` calls and the whole `overrides` plumbing (`RunRecapOptions.overrides`, `resolveConfig`'s overrides parameter). There is no `unregisterFlag`; deletion is sufficient.
- Delete the `session_start` no-model warning (`RECAP_MODEL_UNSET_WARNING`); a null Recap Model must produce no startup warning. Resume/fork now call `runRecap(ctx, "startup")` unconditionally; preflight handles null silently and reports missing/unauthenticated models.
- Rename `currentIntervalSeconds` to `currentIdleDelaySeconds` and cache `autoRecapEnabled` alongside it at `session_start`; `scheduleIdleRecap` runs only when enabled and delay > 0. Setters and menu Save update both cached values and reschedule/clear the timer.
- `session_compact` → `runRecap(ctx, "compaction")`; idle tick → `runRecap(ctx, "auto")`; bare `/recap` → `runRecap(ctx, "manual")` (still force-refreshes immediately, ignoring the Auto Recap toggle).
- Command handler: dispatch on `parseRecapCommand(args)`:
  - `refresh`: clear timer, run manual recap, reschedule when idle (as today).
  - `settings`: `if (!ctx.hasUI)` notify "Recap: interactive settings require TUI mode. Typed /recap subcommands remain available." else open the menu (M4; a temporary stub notify is acceptable during M3 development only).
  - `config`: notify the effective migrated config in canonical terms, e.g. `Recap: model=<provider/id|(none)> thinking=<level> auto=<on|off> idleDelay=<n>s recentMessages=<n> maxWords=<n>`.
  - `auto`: persist; `on` reschedules if idle, `off` clears the timer; Idle Delay untouched either way.
  - `model`: `refresh()` then `find()`. Found → clamp stored thinking level via `clampThinkingLevel`, persist model plus clamped level in one save, notify (mention the clamp if it changed). Not found → still persist the ref (configured-but-missing is a representable state per the generation gates) with a warning that it is not currently available or authenticated. `none` → persist `recapModel: null`.
  - `thinking`: no model configured → store any valid level (generic storage for later clamping). Model configured → resolve, clamp, persist the effective level, notify the effective level.
  - `delay`/`messages`/`words`: persist; `delay` also updates the cached delay and reschedules if enabled and idle.
  - `usage`/`unknown`: notify the message as warning.
- Update the registered command description to the new subcommand list.

**Done when:** `pnpm check`, `pnpm lint`, and all existing bun scripts pass; manual smoke test covers bare `/recap`, `/recap config`, `/recap model none`, `/recap thinking high`, and an auto tick.

## M4: Settings menu (src/settings-menu.ts)

**Goal:** the staged `/recap settings` TUI menu.

Architecture: one `ctx.ui.custom<"saved" | "cancelled">()` overlay hosting an internal screen stack (push/pop inside a single custom() call, not nested custom() calls). One shared draft closure, unambiguous Escape semantics, one `done()` exit.

```ts
export async function openRecapSettingsMenu(deps: {
  ui: ExtensionContext["ui"];
  registry: { refresh(): void; find(...): Model<Api> | undefined; getAvailable(): Model<Api>[] };
  loadConfig(): RecapConfig;
  saveConfig(config: RecapConfig): void;
  onSaved(config: RecapConfig): void; // index.ts updates cached auto flag + delay, reschedules or clears timer
}): Promise<void>
```

Exported pure reducers (unit-tested; the TUI shell is not unit-testable):

```ts
export function applyModelSelection(
  draft,
  selection: { ref: RecapModelRef; model: Model<Api> } | null
): SettingsDraft;
// null: recapModel = null, thinkingLevel unchanged (generic storage).
// model: recapModel = ref AND thinkingLevel = clampThinkingLevel(model, draft.thinkingLevel), applied atomically,
// so "Escape discards both the model change and the clamp" holds for free: Escape simply never calls the reducer.
export function applyThinkingSelection(draft, level): SettingsDraft;
export function applyAutoToggle(draft, enabled): SettingsDraft; // idleDelaySeconds untouched
export function applyNumericValue(draft, field, value): SettingsDraft;
export function parseCustomNumeric(raw: string): number | null; // positive safe integer or null
export function thinkingLevelChoices(model: Model<Api> | null): StoredThinkingLevel[];
// null → all levels; model → getSupportedThinkingLevels(model) (["off"] for non-reasoning models)
export async function performSave(
  draft,
  deps
): Promise<
  | { ok: true; config: RecapConfig; clampedFrom: StoredThinkingLevel | null }
  | { ok: false; reason: string }
>;
```

Screens:

- **main**: `SelectList` of 7 rows in spec order (Recap Model, Recap Thinking Level, Auto Recap, Idle Delay, Recent Messages, Maximum Words, Save), labels showing draft values (`Recap Model: anthropic/claude-sonnet-4-5` or `(none)`, `Idle Delay: 300s`, ...). Theme via `getSelectListTheme()`. Rebuild the item list after each draft change (preserve selection index if SelectList cannot update items in place; verify in M0). Enter pushes a submenu or runs Save. Escape → `done("cancelled")`: draft dropped, nothing persisted, no runtime change.
- **model**: on entry `registry.refresh()`, then list `registry.getAvailable()` only (every listed model has configured auth). Composition: `Container[Text title, Input filter, SelectList]`. First item `None` (stages `recapModel: null`); then one item per model showing model id, provider, and name. Preselect the row matching the draft ref, else None. Key routing: Up/Down/Enter/Escape to the SelectList, everything else to the Input, then apply the input value as the filter (if `setFilter` only matches labels, filter items manually so provider/name are searchable). Select → `applyModelSelection` → pop. Escape → pop, draft untouched. Do not use Pi's `ModelSelectorComponent` (spec rules it out: it needs Pi's internal runtime and writes Pi's default model). Never touch Pi's active or default session model.
- **thinking**: choices from `thinkingLevelChoices(resolvedDraftModel)` (resolve via `registry.find`; if the draft model vanished mid-menu fall back to the full list, Save will catch it). Preselect the draft level. Select → `applyThinkingSelection` → pop.
- **auto**: On/Off selector → `applyAutoToggle` → pop. Disabling preserves the positive draft Idle Delay.
- **preset(field)**: presets plus `Custom…`. Suggested presets: Idle Delay 60/120/300/600/900 s; Recent Messages 10/20/30/50; Maximum Words 50/75/100/150/200. Preset → `applyNumericValue` → pop. Custom → push customInput.
- **customInput(field)**: single `Input`. Submit → `parseCustomNumeric`; valid → apply and pop back to main; invalid → inline error `Text`, dialog stays open, draft unchanged. Escape → pop, draft unchanged.

Save flow, exact order:

1. `registry.refresh()`.
2. If the draft ref is non-null, require a provider+id match in `registry.getAvailable()`. Missing → warning notify `Recap: <provider>/<id> is no longer available; choose another Recap Model.`, stay on main, menu open, nothing written.
3. Clamp the draft thinking level against the resolved model; remember `clampedFrom` if it changed.
4. `saveConfig(draft)` (atomic normalized write; obsolete keys removed). On throw: error notify, menu stays open.
5. `onSaved(config)` applies timer changes.
6. If clamped, info notify `Recap: thinking level clamped to <level> for <provider>/<id>.`
7. `done("saved")`.

Opening and closing submenus never writes; all mutation is draft-only until step 4.

### Tests for M4

`scripts/test-menu.ts`: generic thinking storage with a null model; `applyModelSelection` clamps atomically; auto toggle preserves the delay; `parseCustomNumeric` rejections (zero, negatives, floats, junk, unsafe integers); `performSave` with a fake registry: vanished model → `{ok: false}` and zero `saveConfig` calls; success → normalized config and `clampedFrom` reported; staged-edit semantics (reducers return new drafts; never calling `performSave` means zero `saveConfig` invocations, which is the Escape-discard guarantee).

**Done when:** `pnpm check`, `pnpm lint`, `bun run scripts/test-menu.ts` pass, plus a manual TUI walkthrough: open menu, stage every field, Escape leaves the settings file byte-identical; reopen, Save persists and applies the timer; model search filters; thinking list changes with and without a model; presets and Custom including invalid input; non-TUI mode (`pi -p`) prints the TUI-required message.

## M5: Finish

1. Convert `scripts/test-extract.ts` from console inspection to assertions (spec requires assertion-based scripts).
2. Add a `"test"` script to `package.json` chaining all bun test scripts; keep individual scripts runnable.
3. Update `AGENTS.md` (code organization block, commands) and `README.md` (new command surface, settings menu, config schema and migration note).
4. Bump version to `0.5.0`.

**Done when:**

```bash
pnpm check && pnpm lint && pnpm format:check && pnpm test
```

all pass, and each item in the spec's Acceptance criteria checks out against a manual walkthrough.

## Decisions already made (do not relitigate; flag if the spec contradicts you)

- Typed setters write the full normalized config through the same writer as menu Save; unknown keys inside `piRecap` are dropped on any save.
- Unknown `/recap <text>` is an error, not a refresh; only empty args refresh. Legacy `on`/`off`/`interval`/`recent` get migration hints.
- Compaction and startup group with auto for null-model silence; the empty-conversation notice is manual-only.
- Generation-time clamping persists and notifies only when the persisted value actually changes (self-quiescing).
- `/recap model` persists a ref that is not currently resolvable, with a warning (configured-but-unavailable is representable; the gates report it at generation time).
- A persistence failure during the generation-time clamp does not block generation.

## Known risks

- 0.80.10 API drift vs both the spec and this plan (compat subpath, `max` level, auth env field, SelectList/Input details): M0 verification is mandatory; preserve the spec's intent if names differ.
- The npm safe-chain wrapper may hide 0.80.10 during install; use its skip flag if needed.
- Mid-menu auto-tick clamp persisting while the settings menu is open is overwritten by Save's full write: benign, Save is the user's authoritative snapshot.
