# Task 08: Native settings menu report

## Result

Rebuilt `/recap settings` around Pi TUI's native `SettingsList`, using
`getSettingsListTheme()` for the seven-row main screen. The controller retains its staged draft
and headless key-driving seams while native rows now provide aligned current values, selected-row
descriptions, Enter/Space activation, and the built-in cancel hint.

The overlay is centered at 60% width with a 48-column minimum, 70% maximum height, and one-cell
margin. A rounded `Recap Settings` frame uses ANSI-aware width helpers, `borderMuted` styling, and
an opaque `customMessageBg` interior through `Box`.

## Commit and files

- `c97531c feat(recap): rebuild settings menu on native SettingsList`
- `src/settings-menu.ts`
- `scripts/test-menu.ts`

## Native component semantics

`SettingsList.activateItem()` is a no-op for an item with neither `values` nor `submenu`. Save uses
approved option (a): its one-value `values: ["Save changes"]` configuration triggers the native
`onChange` callback on every Enter or Space, following Pi's own Apply-row pattern. The callback
then runs the unchanged seven-step `performSave` flow.

Submenu factories are synchronous. Recap Model therefore retains one narrow pre-open interception
to await the bounded registry refresh before delegating the activation key to `SettingsList`; the
factory then builds the searchable titled submenu from the refreshed registry. This is the only
component-semantic accommodation, with no behavior deviation from the approved design.

## Rendered main screen

The following is the ANSI-stripped output of `render(80)` using the default draft:

```text
╭─ Recap Settings ─────────────────────────────────────────────────────────────╮
│ → Recap Model           (none)                                               │
│   Recap Thinking Level  low                                                  │
│   Auto Recap            On                                                   │
│   Idle Delay            300s                                                 │
│   Recent Messages       20                                                   │
│   Maximum Words         100                                                  │
│   Save                  Save changes                                         │
│                                                                              │
│   Model used to generate recaps                                              │
│                                                                              │
│   Enter/Space to change · Esc to cancel                                      │
╰──────────────────────────────────────────────────────────────────────────────╯
```

## Verification

- `pnpm check`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `pnpm test`: passed, including all nine Bun behavior suites.
- `bun run ./scripts/test-menu.ts`: passed independently.
- Real dark-theme ANSI render: every line measured exactly 80 visible columns.
- Pre-commit Prettier and ESLint hooks: passed.

`scripts/test-menu.ts` covers all seven main rows, frame and native hint rendering, overlay options,
Escape discard, submenu cancellation, Save order with Auto Recap disabled and a changed Idle Delay,
rejected and failed saves, model search by ID/provider/name, atomic model and thinking clamp,
thinking choices with and without a model, Enter and Space Auto Recap cycling, all presets, and
valid/invalid/cancelled Custom input.

## AC-4 inspection

AC-4 still holds. `src/settings-menu.ts` contains no `ModelSelectorComponent`, active/default model
setter, or Pi thinking-setting write. It only updates the recap draft, persists through the injected
`saveConfig`, and applies recap runtime state through the injected `onSaved` callback.

## Remaining work

No implementation or automated verification remains. The user-owned live TUI check is the only
manual follow-up, as specified.
