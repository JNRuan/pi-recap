# Assignment: 07-review-fixes-r2

## Objective & scope

Apply the five accepted findings from code-review round 2 in this worktree (the run branch,
commit directly). Findings: `review/claude-review-r2.md` (issues 1-5) and
`review/codex-review-r2.md` (issue 1, subsumed by claude's issue 1). Binding scope:
`review/triage-r2.md` (R1-R5). Contracts in `plan.md` (C1-C8) still bind; the spec wins on
behavior. Do not change anything outside the R1-R5 scope.

## The fixes (triage-r2.md, apply all)

R1 sanitizer completion + regression (src/generate.ts:80-87): strip complete ANSI CSI/OSC
escape sequences first; map ALL separators (`\r`, `\n`, `\t`, `\v`, `\f`, U+2028, U+2029) to
spaces; widen the control strip to `[\x00-\x1f\x7f-\x9f]`; collapse whitespace runs; then the
`Recap:` prefix strip and trim. test-trim regressions: bare CR keeps words separated;
`\x1b[31malert\x1b[0m` leaves only "alert"; U+0090, U+009C, U+009D, U+009F, U+2028 stripped.

R2 refresh-rejection degrade (src/config.ts refreshModelRegistry): catch rejection inside
the helper — warn `Recap: model availability refresh failed (<error>); using cached model
information.` and return false; keep the timeout branch unchanged. Tests: a promptly
rejecting refresh still lets preflight proceed with a cached model, typed setters persist,
and the settings menu opens.

R3 tmp-file cleanup (src/config.ts saveRecapConfig): wrap write+rename in try/catch; on
failure best-effort `unlinkSync(temporaryPath)` (swallow unlink errors) then rethrow. Test:
a failing rename leaves no `*.tmp` file behind.

R4 clamp-persist coverage (scripts/test-index.ts, scripts/test-gates.ts): (a) clamp-save
failure path — make the save fail at clamp time, assert the "could not save" error notice,
generation still completes, `lastRecapText` set; (b) reject arm — defer the refresh, run
`/recap thinking low` mid-flight, release, assert the persisted config keeps "low" and no
clamp notice fires from the recap path; (c) re-add a `reasoning: false` → effective "off"
preflight assertion in test-gates.

R5 armed-timer shutdown test (scripts/test-index.ts): emit `session_shutdown` while the idle
timer is verifiably armed (assert timers count 1 → shutdown → 0), no intervening manual
recap; keep the existing in-flight variant.

## Verification requirements

1. Full gate green: `pnpm check && pnpm lint && pnpm format:check && pnpm test`.
2. Each R has its named test present and passing; pre-existing assertions unchanged.
3. Manual: none.

## Project tooling

Test: bun run ./scripts/<script>.ts (note the ./ prefix); pnpm test
Lint: pnpm lint Typecheck: pnpm check
Format check: pnpm format:check Format write: pnpm format
Commit style: Conventional Commits. Husky pre-commit runs lint-staged.

## Worktree & branch

Worktree (absolute): /Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0
Branch: 20260720-0003-spec-0-5-0 (commit directly)

## Reporting

Write your full report to:

/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/tasks/07-review-fixes-r2-report.md

Include: commits, per-finding disposition (R1-R5), checks run with actual results, anything
incomplete. Then report completion. Escalate on any contract conflict.
