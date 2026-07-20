# Code review synthesis — round 1

- Base SHA: d1e9d8c3e0934cd8d48a35ce338259347bc4ef45
- Branch: 20260720-0003-spec-0-5-0 (reviewed at HEAD 41890c3)
- Round: 1 of cap 2
- Lenses run: claude (fable, high) + codex (gpt-5.6-sol, high) — both completed
- Counts: raw 12 findings + 2 doc recommendations → after existence check 12 + 2 (all cited
  files exist at HEAD) → after dedupe 12 + 2 (no exact duplicates; two related pairs noted)

## Findings

| #   | Source     | Severity (source) | Title                                                                                                                                                                      | Files                                              |
| --- | ---------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| S1  | codex #1   | Medium (conf 98)  | Cancelled/stale preflight clamp persists a stale full-config snapshot over newer user settings                                                                             | src/generate.ts:151, src/index.ts:300              |
| S2  | codex #2   | Medium (conf 95)  | Unbounded `registry.refresh()` awaits can wedge generation (`pending` forever) and the settings overlay                                                                    | src/generate.ts:138, src/settings-menu.ts:205      |
| S3  | claude #1  | Medium (conf 85)  | Unhandled promise rejections (eager module-loader promise; background-task chains) can kill the host Pi process                                                            | src/index.ts:248, 280-288                          |
| S4  | claude #2  | Medium (conf 85)  | Model output reaches the TUI unsanitized: ANSI/OSC/CSI escape injection via the recap widget                                                                               | src/generate.ts:79-104, src/index.ts:180           |
| S5  | claude #3  | Medium (conf 80)  | No timeout/cancellation on completion; manual `/recap` silently dropped while pending                                                                                      | src/generate.ts:174-192, src/index.ts:295          |
| S6  | claude #4  | Medium (conf 75)  | `saveRecapConfig` read-modify-rename races other writers; fixed shared tmp path                                                                                            | src/config.ts:171-192                              |
| S7  | claude #5  | Medium (conf 65)  | Version gate throws (not degrades) if the host lacks a string `VERSION` export                                                                                             | src/index.ts:205, src/config.ts:79-93              |
| S8  | claude #6  | Medium (conf 85)  | Empty-conversation feedback regressed to silence for startup/compaction (spec AC-16 bullet is unqualified; base notified unconditionally)                                  | src/index.ts:322-325                               |
| S9  | claude #7  | Medium (conf 90)  | Zero test coverage for in-flight concurrency guards, session_shutdown teardown, and non-idle tick                                                                          | scripts/test-index.ts; src/index.ts:295-461        |
| S10 | claude #8  | Medium (conf 85)  | `saveRecapConfig` failure branches untested (ENOENT fresh install; corrupt JSON refusal)                                                                                   | scripts/test-config.ts, src/config.ts:175-185      |
| S11 | claude #9  | Medium (conf 95)  | Duplicated helpers with divergence (`errorMessage` ×4, positive-int parser ×3, `modelLabel` ×2 disagreeing on null); "thinking level clamped" phrasing off domain language | config/commands/generate/index/settings-menu       |
| S12 | claude #10 | Medium (conf 80)  | Test fixture builders duplicated across three suites, already drifting                                                                                                     | scripts/test-index.ts, test-gates.ts, test-menu.ts |

Doc recommendations (claude): D1 — README/CHANGELOG breaking-removals section (flags, legacy
subcommands, `effort` key, schema normalization); D2 — AGENTS.md count-free suite phrasing.

Related pairs (kept separate; distinct identities): S1/S6 both touch clamp persistence (S1 is
the stale-snapshot logic, S6 the file-level write race); S2/S5 are the two unbounded awaits
in the same pipeline (registry refresh vs completion call).

Existence-check drops: none. Both lenses' reports non-empty and collected against clean tree
with HEAD unchanged (41890c3, coordinator manifest commit only).
