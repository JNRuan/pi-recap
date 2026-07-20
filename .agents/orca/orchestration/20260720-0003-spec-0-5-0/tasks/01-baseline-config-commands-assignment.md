# Assignment: 01-baseline-config-commands

## Objective & scope

Deliver plan task 01: upgrade the Pi runtime baseline to 0.80.10, verify and record the real
0.80.10 API surface (C5 artifact, BEFORE feature code), then rewrite `src/config.ts` to
contract C1 and create `src/commands.ts` to contract C2, with assertion-based bun test scripts
(`test-baseline`, `test-config`, `test-commands`) and the scoped typecheck config
`tsconfig.modules.json`.

Out of scope for this task: `src/index.ts` and `src/conversation.ts` (do not modify either —
repo-wide `pnpm check` is EXPECTED to be red after your rewrite because the old index.ts
imports legacy config exports; that is deterministic and recorded, not something to fix or
shim), `src/generate.ts`, `src/settings-menu.ts`, README/AGENTS.md updates, version bump.

## The plan

The full run plan is at (absolute):
`/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/plan.md`

Read it in full except the coordinator-only "Orchestration" section. **Your task is
"01-baseline-config-commands"** — every other task section is context: read it, do not build it.

Companion sources (same directory, absolute):

- `spec_0_5_0.md` — the spec. Authoritative on **behavior**.
- `source-plan_0_5_0.md` — detailed design. Your task implements its **M0 then M1 sections, in
  that order**. Also read its "Before starting" and "Decisions already made" sections.
- `CONTEXT.md` — domain language. User-facing text says "Recap Model", "Recap Thinking Level",
  "Auto Recap", "Idle Delay"; never "effort" or "interval".

Precedence: spec wins on behavior; the installed `.d.ts` files (which you will record in the
C5 notes) win on API surface. A conflict between them and a pinned contract is a contract
issue: escalate, do not improvise.

Also read in your worktree: `AGENTS.md` (conventions: zero `any`, strictTypeChecked ESLint,
bun scripts, pnpm deps).

## Inputs from completed tasks

None (first task).

## Contracts

You implement C1 and C2 and produce C5, verbatim from the plan (full text in plan.md):

- **C1** — `src/config.ts` exports: `StoredThinkingLevel` (7 values incl. `"max"`),
  `THINKING_LEVELS`, `RecapModelRef`, `RecapConfig` (6 fields, defaults: null / "low" / true /
  300 / 100 / 20), `REQUIRED_PI_VERSION = "0.80.10"`, `isVersionAtLeast`,
  `resolveRecapConfig`, `loadRecapConfig(source: {getGlobalSettings(): unknown})`,
  `buildNormalizedPiRecap`, `saveRecapConfig(config, agentDir?)`. Migration truth tables per
  source-plan M1: valid `autoRecapEnabled` wins, else `intervalSeconds: 0` → disabled /
  positive → enabled / missing → default true; valid positive `idleDelaySeconds` wins, else
  positive `intervalSeconds` supplies it, else 300; explicit `recapModel: null` is a valid
  value that BLOCKS legacy provider/model inference (inference only when the key is absent);
  legacy `effort` is never read. `buildNormalizedPiRecap` emits exactly the 6 new-schema keys.
  `saveRecapConfig` keeps the read-modify-write + tmp-file + renameSync atomic pattern on
  `<agentDir>/settings.json`, preserving all other top-level keys, replacing `settings.piRecap`
  wholesale.
- **C2** — `src/commands.ts`: the `RecapCommand` discriminated union, `parseRecapCommand`,
  `parseModelArg` (FIRST-slash split: `openrouter/deepseek/deepseek-chat-v3` →
  `{provider: "openrouter", id: "deepseek/deepseek-chat-v3"}`), `parsePositiveSafeInt`. Usage
  strings and unknown/legacy-hint formats verbatim from source-plan M1. Only empty/whitespace
  args yield `refresh`; garbage yields `unknown`, never a refresh. Legacy heads `on`, `off`,
  `interval`, `recent` yield `unknown` with migration hints. **commands.ts is pure parsing: no
  Pi imports at all** (C6 depends on this; `getAgentDir` lives in config.ts only).
- **C5** — BEFORE writing any feature code, write
  `/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/tasks/01-baseline-api-notes.md`
  from the installed post-upgrade `.d.ts` files under `node_modules/@earendil-works/`,
  covering every item in source-plan M0 step 2 (completeSimple location; ThinkingLevel union
  incl. whether `max` exists; `SimpleStreamOptions.reasoning` type;
  getSupportedThinkingLevels/clampThinkingLevel; getApiKeyAndHeaders result shape incl. any
  env field; ctx.ui.custom and friends; ctx.hasUI; SelectList ctor/methods/whether items can
  be replaced in place; Input value access + onSubmit/onEscape; Container; Text;
  getSelectListTheme; VERSION), each marked CONFIRMED-AS-SPEC or DIFFERS (with the actual).
  Plus two probes: (a) instantiate a `SelectList` and an `Input` under bun with no TTY and
  record whether construction + input handling work headlessly; (b) run
  `pnpm exec tsc --showConfig` and record whether the root tsconfig's effective include covers
  `scripts/`.

If a C5 finding contradicts C1/C2's Pi types, escalate immediately and wait. If it
contradicts only C3/C4 types (generate/menu contracts — not yours to build), escalate
immediately but CONTINUE your M1 work in parallel; the coordinator re-pins for the later
tasks.

## Assumptions

- Validated (evidence in plan.md "Assumptions"): 0.80.10 published for all three packages;
  current legacy schema and behavior as described; tooling and hooks as described.
- Open, yours to verify: the exact 0.80.10 API surface (the C5 work above); whether safe-chain
  hides 0.80.10 during install (if `pnpm up` cannot resolve, retry with
  `--safe-chain-skip-minimum-package-age` or the unwrapped pnpm binary).

## Implementation notes (binding)

- Upgrade: set the three peerDependency ranges in `package.json` to `">=0.80.10"`, then
  `pnpm up "@earendil-works/pi-ai@0.80.10" "@earendil-works/pi-coding-agent@0.80.10" "@earendil-works/pi-tui@0.80.10"`.
- `tsconfig.modules.json`: extends `./tsconfig.json`, but must **replace the inherited input
  set**: `"include": ["scripts/**/*.ts", "src/**/*.ts"]`,
  `"exclude": ["src/index.ts", "src/conversation.ts"]`. Verify the effective file list with
  `pnpm exec tsc --showConfig -p tsconfig.modules.json` and record it in your report. Globs
  (not `files`) so later tasks' new modules are covered without editing this file.
- No shims for old index.ts imports. Record in your report exactly which repo-wide checks are
  red after your changes and why (the expected state: `pnpm check` fails only in
  `src/index.ts`).
- The pre-commit hook runs prettier + eslint --fix on staged files automatically.

## Verification requirements

1. Must stay green: `bun run scripts/test-extract.ts`;
   `pnpm exec tsc --noEmit -p tsconfig.modules.json`;
   `eslint src/config.ts src/commands.ts`.
2. Tests to add: `scripts/test-baseline.ts` — peer ranges are `">=0.80.10"` for all three
   (read package.json); `isVersionAtLeast` matrix (`0.80.9` false; `0.80.10`, `0.81.0`,
   `1.0.0` true; prerelease-tolerant); **resolved installed versions of all three packages**
   (each installed package's own package.json version, not peer metadata) meet the baseline.
   `scripts/test-config.ts` — all 7 thinking levels accepted, junk → `low`; `effort` ignored;
   all three migration truth tables incl. partial migration; Idle Delay preserved while auto
   disabled; `buildNormalizedPiRecap` exactly 6 keys, no obsolete ones; global-only loading
   via a fake `{getGlobalSettings}` source where project-style values must have no effect;
   `saveRecapConfig` round-trip against a temp dir (obsolete keys removed, sibling top-level
   keys preserved). `scripts/test-commands.ts` — every canonical form; usage on missing
   values; first-slash parsing with multi-slash ids; `none`; legacy heads → `unknown` with
   hints; bare/whitespace → `refresh`; garbage → `unknown`.
3. Edge cases: prerelease suffixes and unequal segment counts in version compare;
   `intervalSeconds: 0` → disabled + 300s delay; unsafe integers rejected; whitespace-only
   model strings.
4. Manual/visual: none.

All test scripts are assertion-based (fail via thrown assertion, non-zero exit), never
console-inspection.

## Project tooling

Install: pnpm install (safe-chain wrapper; add --safe-chain-skip-minimum-package-age if a fresh version fails to resolve)
Build: none
Test: bun run scripts/<script>.ts (each script individually)
Lint: pnpm lint (eslint src/)
Typecheck: pnpm check (tsc --noEmit) — expected RED at src/index.ts after your rewrite; scoped gate: pnpm exec tsc --noEmit -p tsconfig.modules.json
Format check: pnpm format:check (prettier --check .)
Format write: pnpm format (prettier --write .)
Commit style: Conventional Commits (feat:, fix:, chore:, docs:, optional scope e.g. feat(recap):). Husky pre-commit runs lint-staged.

## Worktree & branch

Worktree (absolute): /Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0-01-baseline-config-commands
Branch: 20260720-0003-spec-0-5-0-01-baseline-config-commands

All work happens in this worktree. Anchor every shell command and file operation to the
absolute worktree path; `cd` in one command does not move your session.

## Reporting

Commit all work in the commit style above. Write your full report to:

/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/tasks/01-baseline-config-commands-report.md (absolute path)

The report must include: commits (hashes and messages), files changed, checks run with actual
results (including the tsc --showConfig file list, the two C5 probe results, and the exact
red state of repo-wide `pnpm check`), assumptions you resolved and how, C5 DIFFERS items, and
anything incomplete or concerning. Report what actually happened, not what was supposed to
happen. That report file and `01-baseline-api-notes.md` are the only files you may write
outside your worktree. Then report completion. If blocked, send an escalation instead of
improvising around the blocker.
