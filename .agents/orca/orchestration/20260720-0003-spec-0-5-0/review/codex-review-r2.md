## Tests review

`scripts/test-trim.ts:8` mirrors the incomplete sanitizer character class, so it does not cover other C1 control forms. This gap is included in Issue 1. The other explicitly required round-one regression scenarios are present, and no additional test issue was confirmed.

## Code Issues

**Issue 1** - C1 terminal controls still reach the recap widget
**Severity**: Medium
**Confidence**: 96/100
**Category:** Security
**File:** `src/generate.ts:83`
**Findings:**

- `normalizeRecapText()` strips C0 controls, DEL, and U+009B, but it leaves the rest of the C1 range. This includes U+0090 DCS, U+009C ST, U+009D OSC, and U+009F APC.
- A model response containing a C1 OSC or DCS sequence survives normalization and reaches the terminal. Compatible terminals can interpret these controls instead of displaying them as recap text, so the accepted S4 terminal-control injection fix is incomplete.
- A direct probe confirmed that U+009D, U+009C, and U+0085 survive both `normalizeRecapText()` and Pi TUI `Text.render()`.

**Evidence:**

- The sanitizer removes only `\x00-\x1f`, `\x7f`, and `\x9b` at `src/generate.ts:83`.
- The normalized result is stored at `src/index.ts:382` and passed into `Text` at `src/index.ts:180`.
- Pi TUI preserves the content while wrapping at `node_modules/@earendil-works/pi-tui/dist/components/text.js:51`, then writes the rendered buffer at `node_modules/@earendil-works/pi-tui/dist/tui.js:1028`.
- The regression assertion checks the same incomplete range at `scripts/test-trim.ts:8` and `scripts/test-trim.ts:10`.

**Fix:**

- Strip the complete C1 range after flattening newlines and tabs, for example with `/[\x00-\x1f\x7f-\x9f]/g`.
- Add regression cases for U+0090, U+009C, U+009D, and U+009F.

## Documentation & Artifact Recommendations

**NO RECOMMENDATIONS.**

## Verdict

**Needs work**
