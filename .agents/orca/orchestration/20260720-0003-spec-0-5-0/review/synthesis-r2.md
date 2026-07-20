# Code review synthesis — round 2 (final; cap reached)

- Base SHA: d1e9d8c3e0934cd8d48a35ce338259347bc4ef45
- Branch: 20260720-0003-spec-0-5-0 (reviewed at HEAD 6557070, post fix-wave c288b74)
- Round: 2 of cap 2
- Lenses run: claude (fable, high) + codex (gpt-5.6-sol, high) — both completed
- Counts: raw 6 findings (claude 5, codex 1) → after existence check 6 (all files exist) →
  after dedupe 5 (codex #1 and claude #1 share one identity: incomplete control-character
  sanitization; claude's is the superset)

Both lenses independently verified that all twelve round-1 findings and both doc
recommendations were implemented as triaged.

## Findings

| #   | Source                      | Severity                     | Title                                                                                                                                                                                     | Files                                                              |
| --- | --------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| R1  | both (claude #1 ⊃ codex #1) | Medium (claude 90, codex 96) | Sanitization incomplete: full C1 range (U+0090/9C/9D/9F) and U+2028/9 survive; ANSI residue after ESC-only strip; NEW regression: `\r`/`\v`/`\f` deleted instead of mapped, merging words | src/generate.ts:80-87, scripts/test-trim.ts:8-10                   |
| R2  | claude #2                   | Medium (80)                  | `refreshModelRegistry` degrades on hangs but hard-aborts on prompt rejection — offline blocks preflight, setters, and even opening the settings menu despite cached data                  | src/config.ts:189-216 + 6 call sites                               |
| R3  | claude #3                   | Medium (80)                  | Unique tmp names orphan files on failed saves (no cleanup on write/rename throw)                                                                                                          | src/config.ts:218-240                                              |
| R4  | claude #4                   | Medium (90)                  | Relocated clamp-persist: error branch and reject arm untested; `reasoning: false` preflight coverage lost in test-gates rewrite                                                           | src/index.ts:324-343, scripts/test-index.ts, scripts/test-gates.ts |
| R5  | claude #5                   | Medium (85)                  | Shutdown test's timer-cleared assertion vacuous (timer already cleared by the manual command before shutdown)                                                                             | scripts/test-index.ts:795-815                                      |

Existence-check drops: none. Collection: tree clean outside run folder, HEAD unchanged
(6557070). Cap rule: this is the final round — the wave fixing these findings is verified but
NOT re-reviewed, recorded in summary.md and the PR.
