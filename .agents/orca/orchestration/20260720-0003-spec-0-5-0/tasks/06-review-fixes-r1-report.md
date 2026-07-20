# Task 06: Review fixes round 1 report

## Result

Applied every accepted round-one finding and both documentation recommendations. Generation clamps now persist only by merging into a matching latest configuration, registry refreshes are bounded across generation, typed setters, and menu flows, lifecycle promises and stale completions are guarded, and the required concurrency and persistence regressions are covered.

## Commit

- `c288b74 fix: harden recap refresh and lifecycle behavior`

## Finding dispositions

- **S1 fixed:** `preflightRecap` now returns the effective level and `levelClamped` without writing. `runRecap` reloads configuration after generation-token and leaf checks, compares the latest model and stored level with the preflight snapshot, and merges the clamp into that latest configuration before notifying. `test-index` defers an older refresh, completes `/recap auto off`, and verifies the disabled setting survives while the matching clamp persists.
- **S2 fixed:** `refreshModelRegistry` provides the single 15-second bounded refresh path. Preflight, typed model and thinking setters, menu construction, model submenu entry, and Save use it; timeouts warn and continue with cached registry data. Tests cover a never-resolving generation refresh releasing `pending` and a never-resolving model-submenu refresh releasing the serialized input queue.
- **S3 fixed:** the eager module promise has a rejection guard, background tracking chains terminate in catches, and idle-tick host calls are inside the guarded block.
- **S4 fixed:** `normalizeRecapText` flattens newlines and tabs, strips the specified C0, DEL, and CSI control bytes, then performs label and whitespace normalization. `test-trim` covers flattened lines and escaped control output.
- **S5 fixed:** completion options now use `timeoutMs: 60000` and `maxRetries: 2`. A manual refresh while another refresh is pending reports `Recap: a refresh is already in progress.`; the double-manual deferred-completion test verifies only one completion starts.
- **S6 fixed:** settings writes use a process ID plus random UUID temporary filename. The normalized value and temporary name are prepared before the settings file is read, keeping the read-to-write window minimal.
- **S7 fixed:** version parsing accepts unknown input and returns the guard result for non-strings; registration presents `0.0.0` on that degrade path. Baseline and index tests cover non-string values.
- **S8 fixed:** empty conversations notify for manual, startup, and compaction triggers; Auto Recap remains silent. `test-index` covers all four cases.
- **S9 fixed:** the index harness has deferrable completions and no-drain event emission. Tests cover input during generation, shutdown during generation with timer teardown and later no-op events, leaf changes, double manual dispatch, and non-idle tick rescheduling.
- **S10 fixed:** `test-config` covers fresh-install ENOENT success, invalid JSON refusal with byte preservation, and array-root refusal with byte preservation.
- **S11 fixed:** `errorMessage`, `parsePositiveSafeInt`, and `modelLabel` are exported from `config.ts` and reused. `parseCustomNumeric` delegates to the shared parser, and the menu clamp notice uses `Recap Thinking Level`.
- **S12 fixed:** `scripts/test-support.ts` contains the canonical default configuration, `FakeRegistry`, model and response builders, and notification type. `test-index`, `test-gates`, and `test-menu` use it; `test-config` retains its independent defaults.
- **D1 fixed:** README now has a `Breaking changes in 0.5.0` section covering removed flags, command replacements, the dropped `effort` key, and save normalization.
- **D2 fixed:** AGENTS.md uses count-free test-suite wording.

## Verification

- `pnpm check && pnpm lint && pnpm format:check && pnpm test`: passed before commit and again after commit. All nine executable suites reported passed.
- Staged TypeScript lint, matching the pre-commit hook scope: passed. The first commit attempt exposed script-only lint violations outside `pnpm lint`; they were corrected before the successful commit.
- `git diff --check`: passed before commit.
- Post-commit `git status --short`: clean before this report was created.
- Manual verification: none required.

## Incomplete or concerning

Nothing incomplete. pnpm repeatedly warned that `/Users/stacktrace/.npmrc` could not be read due to `EPERM`; no dependency installation was needed, and every required check completed successfully.
