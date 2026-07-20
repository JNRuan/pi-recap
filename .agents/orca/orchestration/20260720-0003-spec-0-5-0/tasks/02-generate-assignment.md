# Assignment: 02-generate

## Objective & scope

Deliver plan task 02: new `src/generate.ts` implementing contract C3 — the revised recap
system prompt, output normalization, sentence-aware word-limit enforcement, the shared
preflight gates, and DI'd generation through Pi's 0.80.10 compat completion path — plus
assertion-based bun scripts `scripts/test-trim.ts`, `scripts/test-prompt.ts`,
`scripts/test-gates.ts`.

Out of scope: `src/index.ts` (DO NOT modify — repo-wide `pnpm check` is expected red only in
src/index.ts; that is task 04's to resolve), `src/conversation.ts`, `src/settings-menu.ts`,
`tsconfig.modules.json` (its globs already cover your new files — do not edit it),
package.json, docs.

## The plan

Full run plan (absolute):
`/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/plan.md`

Read it in full except the coordinator-only "Orchestration" section. **Your task is
"02-generate"** — other task sections are context: read them, do not build them.

Companion sources (same directory): `spec_0_5_0.md` (behavior authority — your prompt text
comes verbatim from its "Revised prompt" section, and your gates from "Generation gates"),
`source-plan_0_5_0.md` (design authority — your task implements its **M2** section;
also read "Decisions already made"), `CONTEXT.md` (domain language: "Recap Model", "Recap
Thinking Level", "Auto Recap", "Idle Delay"; never "effort"/"interval" in user-facing text).

Also read `AGENTS.md` in your worktree (zero `any`, strictTypeChecked ESLint, bun scripts).

## Inputs from completed tasks

Task 01 (merged into your branch already):

- `src/config.ts` implements C1; `src/commands.ts` implements C2. Import `RecapConfig`,
  `StoredThinkingLevel`, etc. from `./config.js`.
- **C5 API notes** (verified 0.80.10 surface, READ IT):
  `/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/tasks/01-baseline-api-notes.md`
  Key facts: `completeSimple<TApi>(model, context, options?)` is exported from
  `@earendil-works/pi-ai/compat` (NOT the root); `ThinkingLevel` includes `max`;
  `SimpleStreamOptions.reasoning?: ThinkingLevel` (omit for `off`);
  `getSupportedThinkingLevels`/`clampThinkingLevel` from the pi-ai root; auth result is
  `{ok: true; apiKey?; headers?; env?} | {ok: false; error}` — **env exists at 0.80.10, pass
  it through**; `ModelRegistry.refresh()` is **async** (`Promise<void>`).
- Bun quirk from 01's report: invoke scripts as `bun run ./scripts/<file>.ts` (with `./`) —
  the bare form fails with CouldntReadCurrentDirectory in these worktrees.

## Contracts

You implement C3, verbatim from plan.md (read the full C3 section there), with the re-pin:

- `RecapTrigger = "manual" | "auto" | "startup" | "compaction"`.
- `buildRecapSystemPrompt(wordLimit)` — the spec's "Revised prompt" contract verbatim with
  `{wordLimit}` interpolated.
- `normalizeRecapText(raw)` — trim; strip `/^Recap:\s*/i`; trim.
- `enforceWordLimit(text, wordLimit)` — algorithm fixed in source-plan M2: split on `/\s+/`;
  if within limit return unchanged; find sentence boundaries with terminator-run regex +
  closing quote/bracket + whitespace/end lookahead; keep the longest fitting sentence prefix
  plus `…` (U+2026, no preceding space, never adds a word); fallback: first `wordLimit` words
  plus `…`. Never retry generation for length.
- `preflightRecap(config, trigger, deps)` with the gate matrix (spec "Generation gates" +
  source-plan M2): gate 1 null model — manual warns
  ("Recap: no Recap Model configured. Run /recap settings or /recap model provider/model."),
  auto/startup/compaction silent skip; gate 2 **await** `registry.refresh()` (RE-PIN: async at
  0.80.10) then `find()` miss warns on EVERY trigger; gate 3 auth failure warns on every
  trigger; gate 4 clamp via `clampThinkingLevel` — never fails preflight; persists + info-
  notifies only when the effective level differs from stored (self-quiescing); a save throw
  notifies the error but generation continues with the effective level.
- `PreflightDeps.registry` structural type: `{ refresh(): Promise<void>; find(provider, id):
Model<Api> | undefined; getApiKeyAndHeaders(m): Promise<...> }` — narrow and fakeable.
- `export const defaultCompletion` — the real `completeSimple` from
  `@earendil-works/pi-ai/compat`, re-exported; `generateRecapText`'s completion dependency
  defaults to it (tests assert identity and inject fakes through the same seam).
- `generateRecapText`: system prompt from `buildRecapSystemPrompt(wordLimit)`, conversation
  text as a single user message, `apiKey`/`headers`/`env` passed through,
  `...(effectiveLevel !== "off" ? { reasoning: effectiveLevel } : {})`.

Obeys C6: your module owns the version-sensitive pi-ai imports; index.ts will import you
dynamically, so your own imports may be static. Do not import `src/index.ts` or
`src/settings-menu.ts`.

If C3 cannot work as pinned against the real API, escalate; do not reshape.

## Assumptions

- Validated: everything in the C5 notes (trust them; they were verified from installed
  `.d.ts`); C1/C2 merged and green (verified by coordinator).
- Open, yours to verify: exact `completeSimple` context/message shapes when wiring
  `generateRecapText` (consult `node_modules/@earendil-works/pi-ai/dist/compat.d.ts` and
  `types.d.ts` as needed).

## Verification requirements

1. Must stay green: `bun run ./scripts/test-baseline.ts && bun run ./scripts/test-config.ts
&& bun run ./scripts/test-commands.ts && bun run ./scripts/test-extract.ts`;
   `pnpm exec tsc --noEmit -p tsconfig.modules.json`; `pnpm exec eslint src/generate.ts`.
2. Tests to add (assertion-based, fail via non-zero exit):
   - `scripts/test-trim.ts`: normalization (Recap: prefix strip, whitespace); sentence-prefix
     trim; fallback word trim when no sentence fits; at-limit text untouched (no ellipsis);
     ellipsis never adds a word; version numbers (`0.5.0`) survive; multi-terminator `?!`
     runs; text with no terminators.
   - `scripts/test-prompt.ts`: compare `buildRecapSystemPrompt(n)` against the **complete
     expected prompt string** (spec "Revised prompt" verbatim with the limit interpolated)
     for at least two limits; assert the string "50 words" absent.
   - `scripts/test-gates.ts` (fake registry/notify/saveConfig): null-model manual warn vs
     auto/startup/compaction silence; missing model and auth failure warn on both manual and
     auto; clamp persists + notifies exactly once (second run with persisted config performs
     no save and no notify); save-throw path continues generation; `reasoning` absent for
     `off` and present otherwise via a capturing fake injected through the default's seam;
     apiKey/headers/env passed through; identity assertion
     `defaultCompletion === completeSimple` (import from `@earendil-works/pi-ai/compat`).
3. Edge cases: empty text; wordLimit 1; text of exactly wordLimit words.
4. Manual/visual: none.

## Project tooling

Install: pnpm install --safe-chain-skip-minimum-package-age (already installed in this worktree's parent state; only needed if you purge node_modules)
Build: none
Test: bun run ./scripts/<script>.ts (note the ./ prefix)
Lint: pnpm lint (expected RED only from src/index.ts; gate on eslint src/generate.ts)
Typecheck: pnpm check (expected RED only in src/index.ts); scoped gate: pnpm exec tsc --noEmit -p tsconfig.modules.json
Format check: pnpm format:check
Format write: pnpm format
Commit style: Conventional Commits (feat:, fix:, chore:, docs:, optional scope). Husky pre-commit runs lint-staged.

Note: node_modules may not exist in a fresh worktree — run the Install command first if so.

## Worktree & branch

Worktree (absolute): /Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0-02-generate
Branch: 20260720-0003-spec-0-5-0-02-generate

All work happens in this worktree. Anchor every shell command to the absolute worktree path.

## Reporting

Commit all work in the commit style above. Write your full report to:

/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/tasks/02-generate-report.md (absolute path)

Include: commits (hashes, messages), files changed, checks run with actual results,
assumptions resolved, any deviation from C3 (should be none without an escalation), anything
incomplete or concerning. Report what actually happened. That report file is the only file
you may write outside your worktree. Then report completion. If blocked, escalate instead of
improvising.
