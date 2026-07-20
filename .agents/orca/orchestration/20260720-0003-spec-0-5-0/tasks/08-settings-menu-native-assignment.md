# Assignment: 08-settings-menu-native

## Objective & scope

Post-PR UI rework, human-approved: the `/recap settings` menu is hard to read (borderless,
transparent overlay; no key hints; no selection affordance — see the user screenshot issue).
Rebuild the menu presentation on Pi's NATIVE settings pattern so it looks and behaves like
Pi's own `/settings`, wrapped in a rounded framed overlay.

In scope: `src/settings-menu.ts` (rework), `scripts/test-menu.ts` (update controller tests),
minimal touch to `src/index.ts` ONLY if the open-call signature needs an extra dep (e.g.
theme). Out of scope: everything else — config schema, commands, generation, README (unless
a screenshot-adjacent sentence needs updating; skip by default).

Commit directly on the run branch in this worktree.

## Approved design (binding)

Main screen — replace the custom SelectList main screen with pi-tui `SettingsList` themed by
`getSettingsListTheme()` (exported from `@earendil-works/pi-coding-agent` root):

- 7 rows in spec order: Recap Model, Recap Thinking Level, Auto Recap, Idle Delay, Recent
  Messages, Maximum Words, Save.
- Each row: `label` + right-aligned `currentValue` from the DRAFT; a one-line `description`
  (shown when the row is selected) in CONTEXT.md domain language, e.g. "Model used to
  generate recaps", "Reasoning level for recap generation (clamped to the Recap Model)",
  "Generate a recap automatically after the Idle Delay", etc.
- Auto Recap: `values: ["On", "Off"]` so Enter/Space cycles it (draft-only via onChange).
- Recap Model, Recap Thinking Level, Idle Delay, Recent Messages, Maximum Words: `submenu:`
  factories (SettingsList renders the submenu in place and handles Esc-to-close via the
  done callback — verify exact semantics in
  node_modules/@earendil-works/pi-tui/dist/components/settings-list.js).
- The built-in hint footer (SettingsList renders it automatically) provides
  "Enter/Space to change · Esc to cancel" (+ search text if `enableSearch`). Decide
  enableSearch: OFF for the main list (7 rows; search adds noise) — the model submenu keeps
  its own search input.
- Save row: VERIFY how SettingsList's `activateItem` treats an item with neither `values`
  nor `submenu` (read the .js). If Enter on such an item is a no-op, implement Save the
  cleanest working way — options in preference order: (a) an onChange-triggering mechanism
  if one exists; (b) a `submenu` factory that performs the save flow and immediately calls
  its done callback (rendering a transient "Saving…"/error Text if needed); (c) intercept
  Enter for the Save row in the wrapping component before delegating to SettingsList. The
  7-step Save flow (validate model availability → clamp → saveConfig → onSaved → clamp
  notice → close) is unchanged. If none of these can work, escalate.

Submenus — follow Pi's titled-submenu pattern (see
node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/settings-selector.js,
the titled Container at ~line 59): bold accent title Text, optional muted description,
Spacer, then the list.

- Model submenu: keep the searchable composition (Input filter + SelectList over
  `getAvailable()` after bounded refresh, None row first, preselect, filter by id/provider/
  name) with title "Recap Model".
- Thinking submenu: title "Recap Thinking Level", choices as today (model-aware).
- Numeric submenus: title per field, presets + "Custom…" as today; Custom input keeps
  inline-error behavior.

Frame — the overlay currently floats borderless. Add a small frame component (in
settings-menu.ts) that wraps the whole menu: renders children, then adds a rounded border
(`╭─╮ │ ╰─╯`) with the title "Recap Settings" embedded in the top border, using the theme's
border/muted color (the `theme` object is available via the ui.custom factory args — check
what the factory receives at
node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:116 — and/or
`getSelectListTheme`/theme exports). Give the content an opaque background via `Box`'s
`bgFn` if a suitable theme background function is available; if none is exposed to
extensions, the border alone is acceptable — note it in the report. Account for ANSI-aware
width when drawing the frame (pi-tui exports width utils; check dist/utils.d.ts for
truncateToWidth/visibleWidth helpers).

Overlay placement — pass `overlayOptions`: centered anchor (default), `width: "60%"`,
`minWidth: 48`, sensible `maxHeight` (e.g. "70%"), margin 1, replacing whatever options put
it at the top-left.

## Behavior invariants (unchanged, from the plan's C4 + spec)

- All changes draft-only until Save; Escape at main discards everything (zero saveConfig
  calls); submenu Escape pops without draft mutation; Save order saveConfig → onSaved →
  close; vanished-model Save rejection keeps the menu open with nothing written; atomic
  model+clamp on model selection; Auto Recap toggle preserves Idle Delay; never touch Pi's
  active/default model or thinking settings (no ModelSelectorComponent).
- The exported pure reducers and `performSave` keep their signatures (C4); the rework is
  presentation/controller, not semantics.
- The whole menu stays headlessly drivable: `scripts/test-menu.ts`'s controller layer must
  still construct the component with fake deps and drive it with key events. Update the
  tests to the SettingsList-based structure — every existing controller assertion must be
  preserved or have an equivalent (all 7 rows, Escape/discard semantics, Save order with
  auto-off+delay draft, rejected Save, model search by id/provider/name, model→clamp,
  thinking choices with/without model, Auto Recap cycling now via Enter/Space, presets,
  Custom valid/invalid/cancel). Add: frame renders (border chars present, title shown) and
  the hint line appears.

## Verification requirements

1. Full gate: `pnpm check && pnpm lint && pnpm format:check && pnpm test`.
2. Updated `scripts/test-menu.ts` green with the assertion coverage above.
3. Report must include a rendered-output sample (the render() lines of the main screen from
   a headless run, pasted as text) so the coordinator can eyeball the frame, alignment, and
   hint line without a live TUI.
4. Named inspection line: AC-4 still holds (no Pi model/thinking writes).
5. Manual: none (the user will do the live TUI check on the PR).

## Project tooling

Test: bun run ./scripts/<script>.ts (note the ./ prefix); pnpm test
Lint: pnpm lint Typecheck: pnpm check Format check: pnpm format:check
Commit style: Conventional Commits (e.g. `feat(recap): rebuild settings menu on native SettingsList`).

## Worktree & branch

Worktree (absolute): /Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0
Branch: 20260720-0003-spec-0-5-0 (commit directly; it is the open PR #4 branch — do NOT push; the coordinator pushes)

## Reporting

Write your full report to:

/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/tasks/08-settings-menu-native-report.md

Include: commits, files changed, the rendered-output sample, checks run with results, how
Save-on-Enter was implemented (which option), any SettingsList semantics that forced a
deviation (named), the AC-4 inspection line. Then report completion. Escalate rather than
improvise if the approved design cannot be implemented as specified.
