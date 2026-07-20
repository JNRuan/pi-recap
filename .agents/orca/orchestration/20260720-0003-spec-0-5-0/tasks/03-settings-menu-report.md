# 03-settings-menu report

## Result

Implemented contract C4 as one `ui.custom()` overlay backed by a staged, headless-drivable screen stack. The menu covers all seven main rows, searchable Recap Model selection, model-aware Recap Thinking Level selection, Auto Recap, all three preset and custom numeric fields, Escape discard, and the ordered Save flow.

## Commit

- `6426e4a9a4e9933e96c06bd8d1fec9a79e6db8c8` `feat: add staged recap settings menu`

## Files changed

- `src/settings-menu.ts`: reducers, `performSave`, controller, and `openRecapSettingsMenu` wrapper.
- `scripts/test-menu.ts`: reducer and real-component headless controller assertions.

No out-of-scope worktree files changed. In particular, `src/index.ts`, `src/conversation.ts`, and `tsconfig.modules.json` were untouched.

## Implementation notes

- `applyModelSelection` stores model and clamped thinking level atomically. Selecting None preserves the generic stored thinking level.
- Model entry and Save await the asynchronous registry refresh. Model lists come only from `getAvailable()`, with None first and manual filtering across ID, provider, and name.
- Main labels are rebuilt after draft changes while preserving the selected main-row index.
- `performSave` refreshes, rejects vanished models, clamps, saves, calls `onSaved`, emits the clamp notice, then closes, in that order.
- The exported controller serializes raw key events and exposes headless inspection without replacing the real Pi TUI `SelectList`, `Input`, `Container`, or `Text` components.

## Verification

Passed:

- `bun run ./scripts/test-baseline.ts`
- `bun run ./scripts/test-config.ts`
- `bun run ./scripts/test-commands.ts`
- `bun run ./scripts/test-extract.ts`
- `bun run ./scripts/test-menu.ts`
- `pnpm exec tsc --noEmit -p tsconfig.modules.json`
- `pnpm exec eslint src/settings-menu.ts`
- `pnpm exec eslint src/settings-menu.ts scripts/test-menu.ts`
- `pnpm format:check`
- `git diff --check`

Expected pre-task-04 failures, confirmed:

- `pnpm check`: red only in legacy `src/index.ts`, due its removed config imports and pre-0.80.10 Pi API usage.
- `pnpm lint`: red only in legacy `src/index.ts`, cascading from the same unresolved old API and config surface.

The pnpm commands also printed the environment warning that `/Users/stacktrace/.npmrc` could not be read with `EPERM`; this did not prevent scoped checks from passing.

## Controller coverage

The headless controller assertions traverse all seven main rows and cover:

- main Escape, staged-edit discard, and submenu Escape;
- valid Save order `saveConfig` then `onSaved` then close;
- vanished-model and persistence-failure rejection without close or runtime application;
- model searches by ID, provider, and name;
- model selection label update and atomic thinking clamp;
- configured-model supported thinking choices, null-model all-level choices, and selection;
- Auto Recap Off and On with preserved Idle Delay;
- all three preset screens;
- valid, invalid, and cancelled Custom input for each numeric field;
- vanished draft-model thinking fallback and Save rejection;
- empty available-model list with a usable None row;
- the real `openRecapSettingsMenu` `ui.custom()` wrapper in headless mode.

No required controller assertion was omitted or weakened. No manual or visual checks were required by the assignment.

## Assumptions resolved

- Raw input uses terminal strings accepted by Pi TUI, including `\r`, `\x1b`, and `\x1b[B`; real components handled them under Bun.
- `SelectList` has no item replacement API, so changed main and filtered model lists are rebuilt.
- Registry refresh is asynchronous and is awaited at controller creation, model-screen entry, and Save.
- A vanished draft model resolves to the full thinking-level list, while Save validates against the refreshed available list and rejects it.

## AC-4 inspection

**AC-4 inspection: PASS.** There is no `ModelSelectorComponent` import, no import of `src/index.ts`, and no write to Pi's active or default model or thinking settings. The only mutations are the private recap draft, the injected recap config writer on Save, and the injected recap runtime callback after persistence.

## Incomplete or concerning

None within task 03. Integration into `src/index.ts` remains intentionally assigned to task 04.
