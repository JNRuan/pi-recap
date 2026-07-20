# Assignment: 05-finish

## Objective & scope

Deliver plan task 05 (source-plan M5): convert `scripts/test-extract.ts` from console
inspection to assertions, add a `"test"` script to package.json chaining ALL bun test
scripts, update `AGENTS.md` (code map, commands) and `README.md` (new command surface,
settings menu, config schema + migration note), and bump the package version to `0.5.0`.

Out of scope: any `src/` change (the implementation is complete and green — if you believe a
src change is needed, escalate); the docs under `docs/` and `CONTEXT.md` (committed by the
coordinator; you may reference them from README).

## The plan

Full run plan (absolute):
`/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/plan.md`

Read the Overview, Requirements, and your task section "05-finish". Companion sources in the
same directory: `spec_0_5_0.md` (its "Commands" section lists the canonical command surface
your README documents; "Verification requirements" requires assertion-based scripts),
`CONTEXT.md` (domain language — README/AGENTS.md must say "Recap Model", "Recap Thinking
Level", "Auto Recap", "Idle Delay"; never "effort" or "interval").

## Inputs from completed tasks

The full implementation is merged into your branch: `src/config.ts` (new schema + migration),
`src/commands.ts` (canonical grammar), `src/generate.ts` (prompt/trim/gates),
`src/settings-menu.ts` (staged TUI menu), `src/index.ts` (rewired lifecycle; `--recap-*`
flags removed). Nine test scripts exist and pass:
test-baseline, test-config, test-commands, test-extract, test-trim, test-prompt, test-gates,
test-menu, test-index. Repo-wide `pnpm check`, `pnpm lint`, `pnpm format:check` are green.

Current effective config schema (document in README):

```json
{
  "piRecap": {
    "recapModel": null,
    "thinkingLevel": "low",
    "autoRecapEnabled": true,
    "idleDelaySeconds": 300,
    "wordLimit": 100,
    "recentMessageLimit": 20
  }
}
```

Global-only (`~/.pi/agent/settings.json`); project-local `piRecap` ignored; legacy
`provider`/`model`/`intervalSeconds` migrate automatically on next save, `effort` is dropped.
Command surface: `/recap`, `/recap settings|auto on|off|model <provider/model|none>|thinking
<level>|delay <seconds>|messages <count>|words <count>|config`.

Bun quirk: invoke scripts as `bun run ./scripts/<file>.ts` (with `./`).

## Verification requirements

1. `pnpm check && pnpm lint && pnpm format:check && pnpm test` all pass (the last one is the
   script you add).
2. `scripts/test-extract.ts` converted to assertions covering its existing three cases
   (50-turn recency cutoff, compaction entry handling, single oversized message) — failing
   through assertions with non-zero exit, no console-inspection. Do not change
   `src/conversation.ts`.
3. `pnpm test` chains ALL nine bun scripts and fails fast when any script fails (verify by
   temporarily forcing a failure, then reverting).
4. package.json version is `0.5.0`.
5. Manual: none.

## Project tooling

Install: pnpm install --safe-chain-skip-minimum-package-age (only if node_modules missing)
Build: none
Test: bun run ./scripts/<script>.ts ; pnpm test once added
Lint: pnpm lint
Typecheck: pnpm check
Format check: pnpm format:check
Format write: pnpm format
Commit style: Conventional Commits (feat:, fix:, chore:, docs:, optional scope). Husky pre-commit runs lint-staged.

## Worktree & branch

Worktree (absolute): /Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0-05-finish
Branch: 20260720-0003-spec-0-5-0-05-finish

All work happens in this worktree. Anchor every shell command to the absolute worktree path.

## Reporting

Commit all work in the commit style above (docs changes may use `docs:`; version bump
`chore:`). Write your full report to:

/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/tasks/05-finish-report.md (absolute path)

Include: commits, files changed, checks run with actual results (including the forced-failure
fail-fast proof for `pnpm test`), anything incomplete or concerning. Report what actually
happened. That report file is the only file you may write outside your worktree. Then report
completion. If blocked, escalate instead of improvising.
