# Code review — pi-recap 0.5.0 (round 2)

Branch `20260720-0003-spec-0-5-0` vs base `d1e9d8c3e0934cd8d48a35ce338259347bc4ef45`, focused on the round-1 fix wave: commit `c288b74` (range `c06f206..6557070`). Inputs: `review/claude-review-r1.md`, `review/synthesis-r1.md`, `review/triage-r1.md` (S1-S12 + D1/D2 all accepted; S5 and S6 narrowed), `tasks/06-review-fixes-r1-report.md`.

Review process: line-by-line verification of the fix diff against each triage decision by the main reviewer, plus two adversarial Fable subagent passes (correctness/reliability on the fix logic; tests on the reworked suites), then verification and consolidation. Key claims re-verified directly: Promise.race semantics of the new bounded refresh, the sanitization regex chain (executed empirically), the in-flight test interleavings, and the lost-coverage greps. Assumes `pnpm check`, lint, format:check, and all suites pass (fix report attests green before and after commit).

## Fix verification

All twelve findings and both doc recommendations are implemented as triaged. Per item:

- **S1** ✅ `preflightRecap` is side-effect-free (returns `levelClamped`); persistence moved to `runRecap` after the generation/leaf guards, merged into a re-loaded latest config, guarded on model+level matching the snapshot (`src/index.ts:321-344`). The merge test (deferred refresh, `/recap auto off` mid-flight) verifies the accept arm. See Issue 4 for the untested arms.
- **S2** ✅ `refreshModelRegistry` (15s race + warning, `src/config.ts`) now bounds all six former `registry.refresh()` awaits; never-settling-refresh tests cover generation, pending release, and menu Escape. See Issue 2 for the rejection path.
- **S3** ✅ `modules.catch(() => undefined)` at creation; background-task chains end in `.catch(() => undefined)`; idle-tick host calls moved inside the try. Race/rejection semantics verified sound (late rejection of the losing race arm is absorbed; timer cleared in `finally`).
- **S4** ✅ as specified (`\n\t` → space; strip `[\x00-\x1f\x7f\x9b]`; test-trim cases). The specified minimum left gaps and introduced one regression — see Issue 1.
- **S5** ✅ (narrowed) `timeoutMs: 60_000`, `maxRetries: 2` asserted in test-gates; manual-while-pending notifies "Recap: a refresh is already in progress." with a double-dispatch test. Abort-on-input/shutdown remains logged-not-fixed per triage; not re-reported.
- **S6** ✅ (narrowed) unique tmp name `${path}.${pid}.${uuid}.tmp`; write window minimal (the function is fully synchronous). The unique naming created a cleanup regression — see Issue 3.
- **S7** ✅ `isVersionAtLeast(actual: unknown, ...)`, non-string → `"0.0.0"` → graceful gate message; baseline and index tests cover `undefined` and `80`.
- **S8** ✅ empty-conversation notice for manual/startup/compaction, silent for auto; all four trigger cases tested.
- **S9** ✅ deferred-completion harness; input/shutdown/leaf-change during flight, double manual, and non-idle tick all genuinely exercise the production guards (interleavings traced: each guard's deletion would fail a concrete assertion). One vacuous assertion — see Issue 5.
- **S10** ✅ ENOENT fresh-dir success, invalid-JSON refusal with byte-identical file, array-root refusal.
- **S11** ✅ `errorMessage`/`parsePositiveSafeInt`/`modelLabel` consolidated into config.ts; `parseCustomNumeric` delegates; menu clamp notice now uses "Recap Thinking Level". `modelLabel`'s "(none)" branch is unreachable from generate.ts (ref is non-null there) — no behavior change.
- **S12** ✅ `scripts/test-support.ts` extracted; `makeModel` now always emits a `thinkingLevelMap` (fixing the old test-gates drift) and matches pi 0.80.10 `clampThinkingLevel` semantics; test-config keeps its independent spec-default derivation per triage.
- **D1** ✅ README "Breaking changes in 0.5.0" section (flags, legacy subcommands, `effort`, save normalization). **D2** ✅ AGENTS.md count-free phrasing.

**Tests review** — see findings above (Issues 4, 5).

## Code Issues

**Issue 1** - Sanitization deletes `\r`/`\v`/`\f` (merging words) and leaves ANSI residue and C1/Unicode-separator gaps
**Severity**: Medium
**Confidence**: 90/100
**Category:** Bug
**File:** `src/generate.ts:80-87`
**Findings:**

- Only `\n`/`\t` are mapped to spaces; `\r`, `\v`, `\f` fall through to the strip regex and are deleted, joining adjacent words. This is a regression introduced by the fix: pre-fix, `\r` passed through and `\s+`-based word splitting treated it as a separator; post-fix, "fixed the parser\rnext step is tests" becomes "fixed the parsernext step is tests" — corrupted text and wrong word-limit accounting. Bare-CR output from a model is a realistic input.
- Stripping only the ESC byte leaves the rest of an ANSI sequence visible: `ESC[31malert ESC[0m` renders as "[31malert[0m" junk in the widget.
- The C1 control range is stripped only at `\x9b`: `\x9d` (8-bit OSC), `\x90` (DCS), `\x98`/`\x9e`/`\x9f` pass through (xterm-class terminals interpret UTF-8-decoded C1 as controls), and U+2028/U+2029 line separators also survive, so the single-line guarantee is not fully enforced. This refines the S4 fix (which implemented the r1 "at minimum" floor) rather than re-opening it.
  **Evidence:**
- All four behaviors verified by executing the exact production regex chain in Node: bare CR merged words; ANSI residue rendered; U+009D and U+2028 passed through unmodified.
  **Fix:**
- Strip complete ANSI sequences first (CSI and OSC forms), map all separators to spaces (`/[\r\n\t\v\f  ]/g` → " "), widen the control strip to `[\x00-\x1f\x7f-\x9f]`, then collapse runs of whitespace before the `Recap:` prefix strip. Extend `scripts/test-trim.ts` accordingly.

**Issue 2** - `refreshModelRegistry` degrades on hangs but hard-aborts on prompt rejection — including blocking the settings menu
**Severity**: Medium
**Confidence**: 80/100
**Category:** Reliability
**File:** `src/config.ts:189-216` (call sites `src/generate.ts:132`, `src/index.ts:537,590`, `src/settings-menu.ts:202,437,817`)
**Findings:**

- The S2 fix's rationale is "warn and continue with cached model information", but only the never-settles case gets that treatment. If `registry.refresh()` rejects promptly (offline DNS failure, provider 5xx), the `Promise.race` rethrows and every call site aborts: preflight surfaces a raw "Recap failed: <error>" with no recap even when the cached registry contains the configured model; `/recap model` and `/recap thinking` abort without persisting; and `createRecapSettingsController` rejects inside the `ui.custom` factory, so `/recap settings` cannot open at all while the refresh endpoint errors — despite cached data being sufficient to browse and save.
- Fix incompleteness rather than regression (round 1 aborted identically on rejection), but the instant-failure mode is now strictly worse-handled than the slow-failure mode the helper was built for, and the helper is the single seam where one catch fixes all six call sites.
- Verified sound in the same pass: no unhandled rejection when refresh rejects after the timeout; timer always cleared; no double-notification path.
  **Evidence:**
- `await Promise.race([registry.refresh().then(() => true), ...])` rethrows; no call site wraps the helper. Offline trigger traced through the settings-menu factory path.
  **Fix:**
- Handle rejection inside the helper: `registry.refresh().then(() => true, (error) => { notify(\`Recap: model availability refresh failed (\${errorMessage(error)}); using cached model information.\`, "warning"); return false; })`, keeping the timeout branch as-is.

**Issue 3** - Failed settings saves now orphan uniquely-named tmp files
**Severity**: Medium
**Confidence**: 80/100
**Category:** Reliability
**File:** `src/config.ts:218-240`
**Findings:**

- The S6 fix switched from a fixed `settings.json.tmp` (self-overwriting: at most one stale file) to `settings.json.<pid>.<uuid>.tmp` per call, with no cleanup when `writeFileSync` or `renameSync` throws (ENOSPC, EACCES, EPERM while another process holds the file). Saves are frequent (every typed setter, menu Save, and the clamp persist that can fire from background auto recaps), so a persistently failing environment accumulates orphans in the agent config directory without bound.
  **Evidence:**
- Pre-fix baseline compared via `git show c288b74~1:src/config.ts`; current code has no try/catch around the write/rename pair and nothing unlinks `*.tmp`.
  **Fix:**
- Wrap write+rename in try/catch; on failure, best-effort `unlinkSync(temporaryPath)` (swallowing its own error) before rethrowing.

**Issue 4** - Relocated clamp-persist logic: the error branch and reject arm are untested, and `reasoning: false` coverage was lost
**Severity**: Medium
**Confidence**: 90/100
**Category:** Test gap
**File:** `src/index.ts:324-343`, `scripts/test-index.ts:700-739`, `scripts/test-gates.ts` (removed block)
**Findings:**

- Pre-fix, test-gates asserted that a throwing clamp save produces the "could not save the effective Recap Thinking Level" error notice and generation continues. The S1 relocation moved that catch into `src/index.ts:337-342` and no suite exercises it anymore (`grep "could not save" scripts/` → no matches; test-menu's "disk full" case covers `performSave`, a different path). Rethrowing or returning from that catch keeps every suite green while a user with a read-only agent dir loses recap generation whenever a clamp fires.
- The new stale-clamp test only exercises the accept arm (it varies `autoRecapEnabled`, which no guard conjunct checks). The reject arm — skipping the save when the user changed `thinkingLevel` or the model mid-flight — is the actual protection S1 was about, and deleting the `latestConfig.thinkingLevel === config.thinkingLevel` conjunct (or either model-equality conjunct) at `src/index.ts:329` keeps all suites green. Trigger: `/recap thinking low` while an auto recap holding a stale "max" snapshot awaits the model → without the guard, the user's "low" is silently overwritten.
- Collateral: the old `reasoning: false` → `effectiveLevel "off"` preflight assertion was deleted in the test-gates rewrite and not recreated (no `reasoning: false` anywhere in scripts/).
  **Evidence:**
- Greps for "could not save" and "reasoning: false" verified by the main reviewer; the merge test's assertions confirmed equally consistent with an unconditional save.
  **Fix:**
- Index-level test: limited model + `thinkingLevel: "max"`, make the save fail at clamp time (e.g. read-only agentDir after start; loads go through `settingsSourceFactory` and still work), assert the error notice, a completed generation, and `lastRecapText` set.
- Sibling reject-arm test: defer the refresh, run `/recap thinking low` mid-flight (reset `registry.refreshImplementation` first since the setter also refreshes), release, then assert `readConfig().thinkingLevel === "low"` and no clamp notice from the recap path.
- Re-add a `reasoning: false` → `"off"` preflight case in test-gates.

**Issue 5** - Shutdown test's "clears timers" assertion is vacuous
**Severity**: Medium
**Confidence**: 85/100
**Category:** Test gap
**File:** `scripts/test-index.ts:795-815`, `src/index.ts:483`
**Findings:**

- In the shutdown-during-flight test, `harness.command("")` runs `runManualRecap`, which calls `clearIdleTimer()` before generating — so `timers.count()` is already 0 when `session_shutdown` is emitted, and the assertion passes even if `clearIdleTimer()` is removed from the shutdown handler (the leaked timer's later tick is neutralized by the `!alive` guard, indistinguishable to the test). No other test emits `session_shutdown`, so "an armed idle timer is cancelled at shutdown" has zero coverage.
  **Evidence:**
- Trace verified by the main reviewer: timer count is 1 after `start()`, drops to 0 at the manual command, before the shutdown emission.
  **Fix:**
- Add a case that emits `session_shutdown` while the timer is verifiably armed (idleDelaySeconds 1, assert `timers.count() === 1`, shutdown with no intervening manual recap, assert 0). Keep the in-flight variant as a separate case.

## Documentation & Artifact Recommendations

NO RECOMMENDATIONS. (D1 and D2 from round 1 are implemented; nothing new warrants doc changes.)

## Verdict

**Needs work** — five Medium findings, no High/Critical. All twelve round-1 findings and both doc recommendations are correctly implemented within their triaged scope; the residue is two refinements the fixes themselves introduced (sanitization word-merging + tmp-file orphans), one fix-incompleteness (refresh rejection path), and two targeted coverage gaps in the relocated clamp logic and shutdown teardown. All are small, seam-local changes.
