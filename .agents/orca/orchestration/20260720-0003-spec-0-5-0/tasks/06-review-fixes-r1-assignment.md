# Assignment: 06-review-fixes-r1

## Objective & scope

Apply all accepted findings from code-review round 1 to the integration worktree. The full
findings are in the two review reports; the accepted fixes and their pinned scope are in the
triage record. Read all three (same directory as this file, under `review/`):

- `review/claude-review-r1.md` (issues 1–10 + 2 doc recommendations)
- `review/codex-review-r1.md` (issues 1–2)
- `review/synthesis-r1.md` (S1–S12 mapping) and `review/triage-r1.md` (BINDING: the accepted
  fix scope per finding, including the two narrowed/adjusted decisions S6 and S8)

You are fixing in place on the run branch — this worktree, no separate branch. Behavior
contracts from the plan (same directory: `plan.md`, C1–C8) still bind: do not regress any
pinned behavior; the spec (`spec_0_5_0.md`) wins on behavior.

Out of scope: anything not in the triage record; new features; docs/ or CONTEXT.md changes.

## The fixes (from triage-r1.md, apply all)

S1 preflight persists stale snapshot (codex#1) — make `preflightRecap` side-effect-free for
the clamp (return effective level + whether clamping occurred); after the generation-token
and leaf checks pass in `runRecap`, RE-LOAD the latest config and persist the clamped level
only if the latest model + stored level still match the preflight snapshot, merging the level
into the latest config. The clamp notify still fires when persisted (spec requires
update+notify; keep self-quiescing). Regression test: a setter completes while an older
preflight is deferred; the setter's config survives.

S2 unbounded refresh (codex#2) — one bounded refresh helper (15s timeout) used by
preflight, typed model/thinking setters, menu entry, and Save; on timeout release `pending`,
warn, and continue with the cached registry snapshot where defensible (or fail the gate).
Tests with a never-resolving refresh for generation and the menu input queue.

S3 unhandled rejections (claude#1) — guard the eager module promise
(`modules.catch(() => {})`; consumers still see rejections at their awaits), add `.catch` to
background-task tracking chains, move the pre-`try` host calls in the idle tick inside the
try/catch.

S4 output sanitization (claude#2) — `normalizeRecapText`: map `\n`/`\t` to spaces, strip
remaining C0/C1 control chars (`\x00-\x1f`, `\x7f`, `\x9b`) before trimming; test-trim cases
(ESC sequence stripped, newline flattened).

S5 completion timeout + pending feedback (claude#3) — pass `timeoutMs: 60000` and modest
`maxRetries` in the completion options; manual `/recap` while a refresh is pending notifies
"Recap: a refresh is already in progress." (info). Do NOT add abort-on-input (logged
decision).

S6 settings write race, narrowed (claude#4) — unique tmp filename (pid + random suffix);
read the settings file immediately before writing. Do NOT switch to in-memory-only clamp
(rejected in triage).

S7 version-gate degrade (claude#5) — non-string version value degrades to the guard path
instead of throwing (treat as "0.0.0" or make parse return null for non-strings);
test-baseline case.

S8 empty-conversation feedback, adjusted (claude#6) — notify "Recap: nothing to recap yet"
for manual, startup, AND compaction; auto stays silent. Update test-index assertions to
match.

S9 lifecycle/concurrency tests (claude#7) — deferrable-completion seam in the test-index
harness; add: (a) `input` during in-flight recap → no widget render, state unchanged;
(b) `session_shutdown` during in-flight → no resurrection, timers cleared, subsequent events
no-op; (c) leaf change during in-flight → stale result dropped; (d) two manual `/recap`
while unresolved → one completion; (e) non-idle tick → zero completions, timer rescheduled.

S10 save failure-branch tests (claude#8) — three temp-dir cases in test-config: ENOENT →
save succeeds from `{}`; invalid JSON → throws (refusal), file byte-identical; array root →
same refusal.

S11 helper consolidation (claude#9) — export `errorMessage`, one positive-safe-int parser,
and one `modelLabel(ref)` from config.ts; use everywhere; align the settings-menu clamp
notice to "Recap Thinking Level" (CONTEXT.md domain language).

S12 test-support extraction (claude#10) — `scripts/test-support.ts` with shared model/
response builders, FakeRegistry, canonical default config; migrate test-index, test-gates,
test-menu; keep test-config's independent spec-default derivation.

D1 README breaking-changes section (flags removed, legacy subcommands removed with
replacements, `effort` dropped, normalization on save). D2 AGENTS.md count-free suite
phrasing.

## Verification requirements

1. Full gate green: `pnpm check && pnpm lint && pnpm format:check && pnpm test`.
2. Every fix has its own test where triage requires one (S1, S2, S4, S7, S8, S9, S10).
3. No pinned behavior regressed: all pre-existing suite assertions still pass unmodified
   except where triage S8 explicitly changes expectations.
4. Manual: none.

## Project tooling

Test: bun run ./scripts/<script>.ts (note the ./ prefix); pnpm test
Lint: pnpm lint Typecheck: pnpm check
Format check: pnpm format:check Format write: pnpm format
Commit style: Conventional Commits (fix:, test:, chore:, docs: as appropriate; one commit
per logical group is fine). Husky pre-commit runs lint-staged.

## Worktree & branch

Worktree (absolute): /Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0
Branch: 20260720-0003-spec-0-5-0 (the run branch — commit directly on it)

## Reporting

Write your full report to:

/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/tasks/06-review-fixes-r1-report.md

Include: commits, per-finding disposition (S1–S12, D1–D2: fixed with what, or why not),
checks run with results, anything incomplete. Report what actually happened. Then report
completion. If a fix conflicts with a pinned contract or the spec, escalate instead of
improvising.
