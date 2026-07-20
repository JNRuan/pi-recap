# pi-recap — 0.2.0 Specification

## Overview

`pi-recap` 0.2.0 improves the recap widget's placement and perceived responsiveness. The recap should sit directly above the user input area, show a visible loading state while a recap request is in flight, and include enough vertical padding that transcript output, recap text, and the input editor do not visually run together.

## Goals

- Move the recap from below the input editor to above the input editor.
- Make recap generation visibly pending when triggered by `/recap`, resume/fork, compaction, or auto-refresh.
- Preserve the previous successful recap while a refresh is running when possible.
- Add small, consistent spacing between transcript output, recap content, and the user input area.
- Keep the existing recap generation, extraction, configuration, and failure behavior otherwise unchanged.

## Non-goals

- Changing the prompt, word limit, model selection, or conversation extraction rules.
- Adding persistent recap history.
- Adding interactive controls inside the widget.
- Reworking the broader pi TUI layout outside the `pi-recap` widget.

## User-visible behavior

### Recap placement

The recap widget renders with `ctx.ui.setWidget("pi-recap", ..., { placement: "aboveEditor" })`.

- The widget appears below the transcript/output area and above the input editor.
- It must not use `{ placement: "belowEditor" }`.
- Clearing the recap still removes the widget entirely.
- RPC mode continues to use plain widget lines when component factories are unavailable.

### Loading state

Whenever a recap request is accepted and begins work, the widget immediately enters a loading state before conversation extraction or model I/O finishes.

States:

1. **Empty**: no recap exists and no request is pending; the widget is hidden.
2. **Initial loading**: no recap exists and a request is pending; show a dim loading line such as:
   ```
   Recap: Generating recap…
   ```
3. **Refreshing**: a previous recap exists and a request is pending; keep the previous recap visible and append a dim pending suffix, for example:
   ```
   Recap: <previous recap>  Refreshing…
   ```
4. **Ready**: request succeeds; replace the loading state with the new recap.
5. **Failed/skipped**: request fails or is skipped; remove the loading suffix and keep the previous recap if one exists. If no recap exists, hide the widget after showing the existing notification.

Behavioral requirements:

- `/recap` must show loading immediately after argument validation succeeds.
- Auto-refresh, resume/fork refresh, and compaction refresh must also show loading when they start an actual recap request.
- If a request is ignored because another request is already pending, the existing loading state remains unchanged.
- If the conversation is empty, the loading state is cleared and the existing `Nothing to recap yet` notification behavior remains.
- The loading indicator should be static text; animation is optional and not required for 0.2.0.

### Padding and spacing

The recap widget should include a small amount of vertical padding so the recap is visually separated from both surrounding regions.

Requirements:

- Use one blank line above the recap content to separate it from transcript/output text.
- Use one blank line below the recap content to separate it from the input editor.
- Do not add padding when the widget is hidden.
- Wrapped recap lines remain grouped together; padding is only around the widget block, not between wrapped lines.
- The preferred implementation is a `Text` component with horizontal padding `1` and vertical padding `1`, or an equivalent component/string-line output that renders the same spacing.

## Implementation notes

- Replace the current `belowEditor` placement in `setRecap` with `aboveEditor`.
- Track recap widget state separately from model request state, e.g. `lastRecapText` plus `pending`.
- Introduce a small rendering helper that can render all widget states from a single source of truth:
  - hidden when `text` and `loadingLabel` are both absent;
  - `Recap: Generating recap…` for initial loading;
  - `Recap: ${text}  Refreshing…` for refresh loading;
  - `Recap: ${text}` for ready.
- Keep existing failure notifications and avoid blanking a previous successful recap on failure.
- Ensure `session_shutdown` still clears the widget and cancels timers.

## Acceptance criteria

- Starting pi-recap with an existing recap places the widget above the input editor.
- Running `/recap` immediately changes the widget to a loading/refreshing state before the model response returns.
- While refreshing, the previous recap remains readable.
- On success, the loading text disappears and the new recap is shown.
- On failure, the previous recap remains and the loading text disappears.
- There is one visible blank line between transcript output and recap, and one visible blank line between recap and the input editor.
- `pnpm check` and `pnpm lint` pass after implementation.
