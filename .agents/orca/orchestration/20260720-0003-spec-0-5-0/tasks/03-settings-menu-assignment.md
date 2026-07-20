# Assignment: 03-settings-menu

## Objective & scope

Deliver plan task 03: new `src/settings-menu.ts` implementing contract C4 — the staged
`/recap settings` TUI menu as one `ctx.ui.custom()` overlay with an internal screen stack,
exported pure draft reducers, and `performSave` — plus `scripts/test-menu.ts` with a reducer
layer and a headless controller layer.

Out of scope: `src/index.ts` (DO NOT modify — repo-wide `pnpm check` is expected red only in
src/index.ts; that is task 04's to resolve), `src/conversation.ts`, `src/generate.ts`,
`tsconfig.modules.json` (its globs already cover your new files — do not edit it),
package.json, docs.

## The plan

Full run plan (absolute):
`/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/plan.md`

Read it in full except the coordinator-only "Orchestration" section. **Your task is
"03-settings-menu"** — other task sections are context: read them, do not build them.

Companion sources (same directory): `spec_0_5_0.md` (behavior authority — your screens from
"Interactive settings" and "Recap Model selector" and "Recap Thinking Level"),
`source-plan_0_5_0.md` (design authority — your task implements its **M4** section verbatim:
screens, reducers, performSave order, presets; also read "Decisions already made"),
`CONTEXT.md` (domain language: "Recap Model", "Recap Thinking Level", "Auto Recap",
"Idle Delay"; never "effort"/"interval" in user-facing text).

Also read `AGENTS.md` in your worktree (zero `any`, strictTypeChecked ESLint, bun scripts).

## Inputs from completed tasks

Task 01 (merged into your branch already):

- `src/config.ts` implements C1 (`RecapConfig`, `StoredThinkingLevel`, `THINKING_LEVELS`,
  `saveRecapConfig`, ...); `src/commands.ts` implements C2.
- **C5 API notes** (verified 0.80.10 surface, READ IT):
  `/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/tasks/01-baseline-api-notes.md`
  Key facts: `SelectList` ctor `(items, maxVisible, theme, layout?)`, callbacks
  onSelect/onCancel/onSelectionChange, methods setFilter/setSelectedIndex/handleInput/
  getSelectedItem — **no in-place item replacement: rebuild the list (preserve selection
  index) when the draft changes**; `Input` zero-arg ctor, `getValue()` METHOD, `setValue`,
  onSubmit/onEscape; `Container` zero-arg (children/addChild/removeChild/clear);
  `Text(text?, paddingX?, paddingY?)`; `getSelectListTheme()` from pi-coding-agent root;
  `ctx.ui.custom<T>` factory receives `(tui, theme, keybindings, done)`, may be async,
  options `{overlay?, overlayOptions?, onHandle?}`; `getSupportedThinkingLevels` /
  `clampThinkingLevel` from pi-ai root; `ModelRegistry.refresh()` is **async**
  (`Promise<void>`) — RE-PIN: menu entry and Save step 1 must await it.
  **Headless probe: PASS** — SelectList and Input construct, render, and handle
  selection/filter/text/submit/escape under bun with no TTY. Your controller tests rely on
  this.
- Bun quirk from 01's report: invoke scripts as `bun run ./scripts/<file>.ts` (with `./`).

## Contracts

You implement C4, verbatim from plan.md (read the full C4 section there), with the re-pin:

- `openRecapSettingsMenu(deps)` where `deps.registry` is structurally
  `{ refresh(): Promise<void>; find(provider, id): Model<Api> | undefined; getAvailable():
Model<Api>[] }` (await refresh), `loadConfig()`, `saveConfig(config)`, `onSaved(config)`.
- Exported pure reducers per source-plan M4: `applyModelSelection` (null → model null,
  thinking unchanged; model → ref AND `clampThinkingLevel` applied atomically),
  `applyThinkingSelection`, `applyAutoToggle` (idleDelaySeconds untouched),
  `applyNumericValue`, `parseCustomNumeric` (positive safe integer or null),
  `thinkingLevelChoices` (null → all levels; model → `getSupportedThinkingLevels(model)`),
  `performSave` (7-step flow below).
- Screens per source-plan M4: main (7 rows in spec order with draft-value labels), model
  (await refresh, `getAvailable()` only, None row first, preselect draft ref or None, filter
  matches id + provider + name — filter manually if setFilter only matches labels), thinking
  (choices from `thinkingLevelChoices` of the resolved draft model; full list fallback if the
  draft model vanished), auto (On/Off), preset(field) (Idle Delay 60/120/300/600/900s;
  Recent Messages 10/20/30/50; Maximum Words 50/75/100/150/200; plus Custom…),
  customInput(field) (validated; invalid → inline error Text, dialog stays open, draft
  unchanged; Escape → pop, draft unchanged).
- Save flow, exact order: (1) await `registry.refresh()`; (2) non-null draft ref must match
  provider+id in `getAvailable()` — miss → warning notify
  `Recap: <provider>/<id> is no longer available; choose another Recap Model.`, menu stays
  open, nothing written; (3) clamp draft thinking against the resolved model, remember
  `clampedFrom`; (4) `saveConfig(draft)` — on throw: error notify, menu stays open;
  (5) `onSaved(config)`; (6) if clamped, info notify
  `Recap: thinking level clamped to <level> for <provider>/<id>.`; (7) `done("saved")`.
  **Observable order: saveConfig → onSaved → close, asserted by your controller tests.**
- Escape at main → `done("cancelled")`: draft dropped, zero saveConfig calls, no runtime
  change. Submenu Escape pops without draft mutation. Opening/closing submenus never writes.
- Headless-drivable: constructing the `custom()` component with fake deps and feeding key
  events through its input handler exercises the real screen stack, real pi-tui components,
  and real reducers with no terminal. Structure the module so `scripts/test-menu.ts` can do
  exactly that (e.g. export the component factory or a create-controller function the
  `ctx.ui.custom` wrapper also uses).
- Never touch Pi's active or default session model or thinking level; do NOT use
  `ModelSelectorComponent`. Do not import `src/index.ts`.

If C4 cannot work as pinned against the real API, escalate; do not reshape.

## Assumptions

- Validated: everything in the C5 notes; headless constructibility PASS; C1/C2 merged and
  green (verified by coordinator).
- Open, yours to verify: exact key-event routing shapes (`handleInput` input format) — read
  the pi-tui `.d.ts` and the headless probe technique from C5.

## Verification requirements

1. Must stay green: `bun run ./scripts/test-baseline.ts && bun run ./scripts/test-config.ts
&& bun run ./scripts/test-commands.ts && bun run ./scripts/test-extract.ts`;
   `pnpm exec tsc --noEmit -p tsconfig.modules.json`; `pnpm exec eslint src/settings-menu.ts`.
2. `scripts/test-menu.ts` (assertion-based), two layers:
   - **Reducer layer**: generic thinking storage with null model; `applyModelSelection`
     clamps atomically; auto toggle preserves delay; `parseCustomNumeric` rejects zero,
     negatives, floats, junk, unsafe integers; `performSave` vanished model → `{ok: false}`
     - zero saveConfig calls; success → normalized config + `clampedFrom`; reducers pure
       (never calling performSave ⇒ zero saveConfig calls).
   - **Controller layer** (headless, real pi-tui components, fake ui/registry/save deps),
     traversing **all seven main rows**: Escape on main closes with zero saveConfig calls;
     staged edits then Escape discard everything; submenu Escape pops without draft
     mutation; Enter on Save with a valid draft → saveConfig exactly once, then onSaved with
     the saved config, then close — asserted in that order, with a draft that disables Auto
     Recap and changes Idle Delay through the menu; rejected Save (vanished model) notifies,
     keeps the menu open, writes nothing; model search narrows the list for three separate
     queries (by id, by provider, by model name); selecting a model updates the draft label
     and clamps the draft thinking level; thinking screen offers `getSupportedThinkingLevels`
     choices with a configured draft model and all levels with a null draft model, and
     selection updates the draft; Auto Recap screen toggles both ways preserving the delay;
     each of the three preset screens applies a preset to the correct field; Custom input per
     field: valid submit applies and pops, invalid shows inline error with draft unchanged
     and dialog open, Escape cancels with draft unchanged.
3. Edge cases: draft model vanishing mid-menu (thinking falls back to full list; Save
   catches); empty available-model list.
4. Manual/visual: none required beyond the controller tests; name anything they cannot reach
   in your report. Your report MUST contain a named inspection line for AC-4: no
   `ModelSelectorComponent` import, no writes to Pi's own model/thinking settings.

## Project tooling

Install: pnpm install --safe-chain-skip-minimum-package-age (only if node_modules is missing in this worktree)
Build: none
Test: bun run ./scripts/<script>.ts (note the ./ prefix)
Lint: pnpm lint (expected RED only from src/index.ts; gate on eslint src/settings-menu.ts)
Typecheck: pnpm check (expected RED only in src/index.ts); scoped gate: pnpm exec tsc --noEmit -p tsconfig.modules.json
Format check: pnpm format:check
Format write: pnpm format
Commit style: Conventional Commits (feat:, fix:, chore:, docs:, optional scope). Husky pre-commit runs lint-staged.

## Worktree & branch

Worktree (absolute): /Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0-03-settings-menu
Branch: 20260720-0003-spec-0-5-0-03-settings-menu

All work happens in this worktree. Anchor every shell command to the absolute worktree path.

## Reporting

Commit all work in the commit style above. Write your full report to:

/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/tasks/03-settings-menu-report.md (absolute path)

Include: commits (hashes, messages), files changed, checks run with actual results, the AC-4
inspection line, assumptions resolved, any controller assertion you could not implement (named
explicitly), anything incomplete or concerning. Report what actually happened. That report
file is the only file you may write outside your worktree. Then report completion. If
blocked, escalate instead of improvising.
