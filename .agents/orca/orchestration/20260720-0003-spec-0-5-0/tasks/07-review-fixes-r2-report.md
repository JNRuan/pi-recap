# Task 07: Review fixes round 2 report

## Result

Applied all five accepted round-two findings. Recap output now removes complete ANSI CSI and OSC sequences, flattens every required separator, strips the full C0, DEL, and C1 ranges, and collapses whitespace. Registry refresh rejection and temporary-save cleanup now degrade safely, and the missing clamp, reasoning-disabled, refresh-rejection, and shutdown regressions are covered.

## Commit

- `d4436de fix: harden recap sanitization and failure recovery`

## Finding dispositions

- **R1 fixed:** `normalizeRecapText` strips complete 7-bit and 8-bit CSI and OSC sequences before mapping CR, LF, tab, vertical tab, form feed, U+2028, and U+2029 to spaces. It then strips `\x00-\x1f` and `\x7f-\x9f`, collapses whitespace, removes the optional label, and trims (`src/generate.ts:65`, `src/generate.ts:82`). `test-trim` covers bare CR and the other separators, CSI and OSC escapes, the named C1 controls, and both Unicode separators (`scripts/test-trim.ts:8`).
- **R2 fixed:** `refreshModelRegistry` catches a rejected refresh, emits the required cached-information warning with the error text, returns false, and retains the existing timeout path (`src/config.ts:208`). A cached model still passes preflight, both typed model and thinking setters persist through rejection, and the real settings-menu wrapper constructs and opens its controller (`scripts/test-gates.ts:139`, `scripts/test-index.ts:766`, `scripts/test-menu.ts:260`).
- **R3 fixed:** `saveRecapConfig` wraps the temporary write and rename, best-effort unlinks the unique temporary file on either failure, and rethrows the original error (`src/config.ts:243`). `test-config` forces the production rename operation to fail, restores it in `finally`, and verifies no `.tmp` file remains (`scripts/test-config.ts:224`).
- **R4 fixed:** `test-index` makes the agent directory read-only at clamp time and verifies the error notice, completed generation, and stored `lastRecapText` (`scripts/test-index.ts:784`). A sibling deferred-refresh test changes the thinking level to `low` mid-flight and verifies the stale `medium` clamp neither persists nor notifies (`scripts/test-index.ts:811`). `test-gates` restores the `reasoning: false` to effective `off` assertion (`scripts/test-gates.ts:157`). The existing stale-clamp accept-arm assertions remain present.
- **R5 fixed:** `test-index` now starts with an idle timer count of one, emits `session_shutdown` without a manual recap, and verifies the timer count becomes zero (`scripts/test-index.ts:880`). The separate in-flight shutdown test remains present.

## Verification

- Focused suites: `bun run ./scripts/test-trim.ts`, `test-gates.ts`, `test-config.ts`, `test-menu.ts`, and `test-index.ts` all passed.
- Required full gate before commit: `pnpm check && pnpm lint && pnpm format:check && pnpm test` passed. All nine executable suites reported passed.
- Staged TypeScript lint: passed for all seven changed source and test files.
- Pre-commit hook: Prettier and ESLint passed for all seven staged TypeScript files.
- Required full gate after commit: `pnpm check && pnpm lint && pnpm format:check && pnpm test` passed. All nine executable suites reported passed.
- `git diff --check`: passed before and after commit.
- Manual verification: none required.

## Incomplete or concerning

Nothing incomplete. pnpm repeatedly warned that `/Users/stacktrace/.npmrc` could not be read due to `EPERM`; no package installation was performed, and every required command completed successfully.
