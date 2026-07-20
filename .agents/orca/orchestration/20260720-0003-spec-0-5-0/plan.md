---
run: 20260720-0003-spec-0-5-0
source: docs/specs/spec_0_5_0.md
base: main
base_sha: d1e9d8c3e0934cd8d48a35ce338259347bc4ef45
branch: 20260720-0003-spec-0-5-0
plan_review_tier: medium
run_complexity: pending
created: 2026-07-20T00:10:52Z
modified: 2026-07-20T00:10:52Z
---

# Plan: pi-recap 0.5.0 — interactive settings, model-aware thinking, revised prompt

## Overview

pi-recap is a Pi coding-agent extension (three source files, ~800 lines) that renders a session
recap widget. Release 0.5.0 replaces its legacy configuration and command surface: a new
global-only `piRecap` schema with deterministic legacy migration, a canonical `/recap` subcommand
grammar, a staged TUI settings menu, model-aware recap thinking levels clamped through Pi's
`clampThinkingLevel`, generation through the model-agnostic `completeSimple` path, a revised
recency-weighted prompt with sentence-aware output trimming, and an assertion-based test suite.
The Pi runtime baseline moves from 0.74.0 to >= 0.80.10.

Authoritative sources, snapshotted in this run folder (`<RUNDIR>`):

- `spec_0_5_0.md` — the spec (authoritative on behavior).
- `source-plan_0_5_0.md` — the human-written implementation plan (authoritative on design detail;
  its milestone sections M0–M5 are incorporated into the tasks below by direct reference).
- `CONTEXT.md` — domain language. User-facing text says "Recap Model", "Recap Thinking Level",
  "Auto Recap", "Idle Delay"; never "effort" or "interval".

Where this plan, the source plan, and the spec disagree, the spec wins; note discrepancies in
reports.

## Review Policy

- **Plan-critique cap used**: 2 (from `plan_review_tier: medium`)
- **Run-complexity rationale**: pending until critique ends. Draft assessment: whole-extension
  rewrite but a single small subsystem; no auth/payments/data-migration/concurrency primitives
  (an idle `setTimeout` only); failure impact limited to a dev-tool widget; observability good
  after this run (typed, linted, assertion suite). Draft tier: medium.
- **Code-review cap**: pending
- **Adversarial QA**: pending

## Requirements & Acceptance Criteria

Quoted from `spec_0_5_0.md` "Acceptance criteria":

- **AC-1**: A user can configure every recap setting without editing JSON.
- **AC-2**: The Recap Model defaults to null and the Recap Thinking Level defaults to low.
- **AC-3**: A null Recap Model produces no model call or startup warning; manual refresh warns
  while Auto Recap skips silently.
- **AC-4**: No menu action changes Pi's active or default model or thinking level.
- **AC-5**: The selected Recap Thinking Level is the effective level sent through Pi's
  model-aware mapping.
- **AC-6**: Unsupported thinking levels cannot remain silently effective.
- **AC-7**: Menu changes persist only after Save; Escape leaves global settings and runtime
  behavior unchanged.
- **AC-8**: Auto Recap can be disabled and re-enabled without losing its Idle Delay.
- **AC-9**: Existing global `intervalSeconds` settings load with the agreed inferred state.
- **AC-10**: Project-local recap settings have no effect.
- **AC-11**: The generated recap follows the recency-weighted task-checkpoint contract and
  configured maximum length.
- **AC-12**: Bare `/recap` still refreshes immediately, and typed subcommands remain usable.

Supporting requirements (spec "Runtime baseline", "Commands", "Verification requirements"):

- **AC-13**: Pi >= 0.80.10 baseline enforced (peer ranges, lockfile, runtime guard).
- **AC-14**: All `--recap-*` CLI flags removed; legacy subcommands rejected with migration hints.
- **AC-15**: The spec's verification list is covered by assertion-based bun scripts that fail
  through assertions, and `pnpm check && pnpm lint && pnpm format:check && pnpm test` passes.

Human decisions from the understanding check (settled):

- The PR commits `CONTEXT.md`, `docs/specs/`, and `docs/adr/` (`docs/agents` stays gitignored).
  The coordinator copies and commits these verbatim onto the run branch.
- The user's `feat-spec-5-0` branch is untouched; the PR targets `main`.
- Interactive TUI walkthroughs are approximated (test suites + `pi -p` non-TUI checks where
  feasible); anything requiring a live interactive TUI session is recorded as not manually
  verified, never silently claimed.

## Out of Scope

- Editable prompt text via settings (prompt stays built-in).
- Any change to Pi's active or default session model or thinking level (`ModelSelectorComponent`
  is explicitly ruled out).
- Retaining legacy commands, aliases, or `--recap-*` flags; migrating the legacy `effort` key.
- Changes to `src/conversation.ts` beyond what test conversion touches (spec: unchanged).
- CI setup; publishing.

## Assumptions

- **Validated** (scout reports `scout-discovery.md`, `scout-code.md`, `scout-tests.md`):
  - 0.80.10 is published for all three Pi packages; installed is 0.74.0 (pnpm-lock.yaml:11-20).
  - Current code shape matches the source plan's description: legacy schema (config.ts:6-13),
    project-over-global merge (config.ts:62-68), multi-slash rejection (config.ts:78), four
    `--recap-*` flags (index.ts:296-314), widget-before-gates (index.ts:158 vs :169-178),
    `RECAP_MODEL_UNSET_WARNING` at session_start (index.ts:334-336), `complete` not
    `completeSimple` (index.ts:188).
  - At 0.74.0: `completeSimple` exported from pi-ai root; `ThinkingLevel` has no `max`;
    `getSupportedThinkingLevels`/`clampThinkingLevel` exist; auth result has no env field;
    SelectList cannot replace items in place; `Input.getValue()` is a method.
  - Tooling: `pnpm check|lint|format:check`, bun for scripts, no build/test scripts today,
    husky+lint-staged auto-formats staged files on commit, Conventional Commits.
  - Only test artifact is console-based `scripts/test-extract.ts`; config.ts and index.ts have
    zero coverage.
- **Open** (assigned to task 01, verified before any feature code):
  - Exact 0.80.10 API surface: `completeSimple` location (root vs `/compat`), `max` in
    `ThinkingLevel`, `SimpleStreamOptions.reasoning` type, auth-result env field,
    SelectList/Input/Container details, `getSelectListTheme` and `VERSION` exports. Task 01
    records the verified surface in a sync artifact all later tasks receive.
  - The safe-chain pnpm wrapper may hide 0.80.10 during install; fall back to
    `--safe-chain-skip-minimum-package-age` or the unwrapped tool.

## Contracts

Pinned before dispatch. A contract change goes through the coordinator, never a worker.
Signatures are from `source-plan_0_5_0.md`; if task 01's API verification contradicts a Pi type
named here, the coordinator re-pins (escalate, do not improvise).

### C1 — config module (`src/config.ts`)

```ts
export type StoredThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const THINKING_LEVELS: readonly StoredThinkingLevel[];
export interface RecapModelRef {
  provider: string;
  id: string;
}
export interface RecapConfig {
  recapModel: RecapModelRef | null; // default null
  thinkingLevel: StoredThinkingLevel; // default "low"
  autoRecapEnabled: boolean; // default true
  idleDelaySeconds: number; // default 300
  wordLimit: number; // default 100
  recentMessageLimit: number; // default 20
}
export const REQUIRED_PI_VERSION = "0.80.10";
export function isVersionAtLeast(actual: string, required: string): boolean;
export function resolveRecapConfig(rawPiRecap: unknown): RecapConfig;
export function loadRecapConfig(source: { getGlobalSettings(): unknown }): RecapConfig;
export function buildNormalizedPiRecap(config: RecapConfig): Record<string, unknown>;
export function saveRecapConfig(config: RecapConfig, agentDir?: string): void;
```

Migration truth tables are fixed in `source-plan_0_5_0.md` M1 (recapModel, autoRecapEnabled,
idleDelaySeconds tables; explicit `recapModel: null` blocks legacy inference; `effort` never
read). All writers (menu Save and typed setters) write the full normalized 6-key object.

### C2 — command module (`src/commands.ts`)

```ts
export type RecapCommand =
  | { kind: "refresh" }
  | { kind: "settings" }
  | { kind: "config" }
  | { kind: "auto"; enabled: boolean }
  | { kind: "model"; model: RecapModelRef | null }
  | { kind: "thinking"; level: StoredThinkingLevel }
  | { kind: "delay"; seconds: number }
  | { kind: "messages"; count: number }
  | { kind: "words"; count: number }
  | { kind: "usage"; message: string }
  | { kind: "unknown"; message: string };
export function parseRecapCommand(args: string): RecapCommand;
export function parseModelArg(raw: string): RecapModelRef | null; // FIRST-slash split
export function parsePositiveSafeInt(raw: string): number | null;
```

Usage strings and the unknown/legacy-hint message format are fixed in `source-plan_0_5_0.md` M1.
Only empty/whitespace args yield `refresh`.

### C3 — generation module (`src/generate.ts`)

```ts
export type RecapTrigger = "manual" | "auto" | "startup" | "compaction";
export function buildRecapSystemPrompt(wordLimit: number): string; // spec "Revised prompt" verbatim
export function normalizeRecapText(raw: string): string;           // trim; strip /^Recap:\s*/i; trim
export function enforceWordLimit(text: string, wordLimit: number): string; // sentence-aware, U+2026
export interface PreflightDeps { registry: {...structural...}; notify(...): void; saveConfig(...): void; }
export type PreflightResult =
  | { ok: true; model: Model<Api>; auth: ResolvedAuth; effectiveLevel: ModelThinkingLevel }
  | { ok: false };
export async function preflightRecap(config: RecapConfig, trigger: RecapTrigger, deps: PreflightDeps): Promise<PreflightResult>;
export async function generateRecapText(...): Promise<string>; // DI'd completion fn, defaults to real completeSimple
```

Gate order/notification matrix and the enforceWordLimit algorithm are fixed in
`source-plan_0_5_0.md` M2. `reasoning` passed only for enabled levels, omitted for `off`.

### C4 — settings menu (`src/settings-menu.ts`)

```ts
export async function openRecapSettingsMenu(deps: {
  ui: ExtensionContext["ui"];
  registry: { refresh(): void; find(...): Model<Api> | undefined; getAvailable(): Model<Api>[] };
  loadConfig(): RecapConfig;
  saveConfig(config: RecapConfig): void;
  onSaved(config: RecapConfig): void;
}): Promise<void>;
// plus exported pure reducers: applyModelSelection, applyThinkingSelection, applyAutoToggle,
// applyNumericValue, parseCustomNumeric, thinkingLevelChoices, performSave — signatures in
// source-plan_0_5_0.md M4.
```

Screen structure, key routing, and the 7-step Save flow are fixed in `source-plan_0_5_0.md` M4.
One `ctx.ui.custom()` overlay hosting an internal screen stack; draft-only mutation until Save.

### C5 — sync artifact from task 01

Task 01 writes `<RUNDIR>/tasks/01-baseline-api-notes.md`: verified 0.80.10 exports and
signatures for every item in `source-plan_0_5_0.md` M0 step 2, each marked
CONFIRMED-AS-SPEC / DIFFERS (with actual). Later assignments quote it verbatim.

## Tasks

| seq | slug            | deps   | complexity | builder           | covers                                   |
| --- | --------------- | ------ | ---------- | ----------------- | ---------------------------------------- |
| 01  | baseline        | —      | medium     | codex sol · high  | AC-13                                    |
| 02  | config-commands | 01     | medium     | codex sol · high  | AC-2, AC-8, AC-9, AC-10, AC-14 (parsing) |
| 03  | generate        | 02     | medium     | codex sol · high  | AC-3, AC-5, AC-6, AC-11                  |
| 04  | settings-menu   | 02     | high       | codex sol · xhigh | AC-1, AC-4, AC-7                         |
| 05  | index-rewrite   | 03, 04 | high       | codex sol · xhigh | AC-3, AC-5, AC-12, AC-14                 |
| 06  | finish          | 05     | medium     | codex sol · high  | AC-15                                    |

### 01-baseline

- **What**: `source-plan_0_5_0.md` M0 in full — peer ranges to `">=0.80.10"`, upgrade all three
  Pi packages to 0.80.10 (lockfile updated), `isVersionAtLeast` + `REQUIRED_PI_VERSION` in
  `src/config.ts` (added alongside the existing code; task 02 rewrites the rest),
  `scripts/test-baseline.ts`, and the C5 API-verification artifact.
- **Why**: everything downstream compiles against 0.80.10; the API notes de-risk every later task.
- **Deps / Inputs**: none.
- **Contracts**: produces C5; `isVersionAtLeast`/`REQUIRED_PI_VERSION` part of C1.
- **Constraints & Context**: safe-chain wrapper may hide the new versions — use
  `--safe-chain-skip-minimum-package-age` or unwrapped pnpm if resolution fails. `pnpm check`
  may fail after upgrade because old `index.ts` compiles against new types; record actual
  errors in the report; do not fix them (task 05 rewrites index.ts). Do not modify other src
  behavior.
- **Relevant existing code**: `package.json:15-19` (peer `"*"`), `pnpm-lock.yaml:11-20`,
  `src/config.ts` (add exports), `node_modules/@earendil-works/*/dist/*.d.ts` post-upgrade.
- **Verification requirements**:
  1. `bun run scripts/test-extract.ts` still runs (conversation API unchanged).
  2. Add `scripts/test-baseline.ts`: peer ranges assert `">=0.80.10"`; `isVersionAtLeast`
     matrix (`0.80.9` false; `0.80.10`, `0.81.0`, `1.0.0` true; prerelease-tolerant);
     installed `VERSION` meets baseline.
  3. Edge cases: prerelease suffixes, unequal segment counts.
  4. Manual: none.
- **Covers**: AC-13.

### 02-config-commands

- **What**: `source-plan_0_5_0.md` M1 in full — rewrite `src/config.ts` to C1 (types, defaults,
  per-field migration truth tables, global-only `loadRecapConfig`, `buildNormalizedPiRecap`,
  atomic `saveRecapConfig` preserving sibling top-level settings keys), new `src/commands.ts`
  to C2, plus `scripts/test-config.ts` and `scripts/test-commands.ts`.
- **Why**: the schema and grammar every other task builds against.
- **Deps / Inputs**: 01 (0.80.10 installed; C5 notes; `isVersionAtLeast` already in config.ts —
  keep it).
- **Contracts**: implements C1, C2 exactly.
- **Constraints & Context**: delete the project-settings merge entirely (spec: project `piRecap`
  silently ignored). Legacy `effort` never read. Explicit `recapModel: null` blocks legacy
  provider/model inference. First-slash parsing replaces the multi-slash rejection at
  config.ts:78. Typed setters and Save share the one normalized writer. `src/index.ts` still
  imports old names and will not compile until task 05 — that is expected; keep the old
  exports it needs only if trivially cheap, otherwise let `pnpm check` fail repo-wide and gate
  on `eslint src/config.ts src/commands.ts` plus the two bun scripts (per source plan M1
  done-when).
- **Relevant existing code**: `src/config.ts` (all), `src/index.ts:412-517` (current subcommand
  surface being replaced), `scripts/test-extract.ts` (bun test style).
- **Verification requirements**:
  1. `bun run scripts/test-baseline.ts`, `scripts/test-extract.ts` stay green.
  2. `scripts/test-config.ts`: all 7 levels accepted, junk→`low`; `effort` ignored; the three
     migration truth tables incl. partial migration; delay preserved while auto disabled;
     `buildNormalizedPiRecap` exactly 6 keys; global-only loading via fake source (project
     values must have no effect); save round-trip in temp dir (obsolete keys removed, sibling
     keys preserved). `scripts/test-commands.ts`: all canonical forms; usage on missing values;
     first-slash multi-slash ids; `none`; legacy heads → `unknown` with hints; bare/whitespace →
     `refresh`; garbage → `unknown`.
  3. Edge cases: `intervalSeconds: 0` → disabled + 300s delay; unsafe integers rejected;
     whitespace-only model strings.
  4. Manual: none.
- **Covers**: AC-2, AC-8 (config side), AC-9, AC-10, AC-14 (parsing side).

### 03-generate

- **What**: `source-plan_0_5_0.md` M2 in full — new `src/generate.ts` to C3 (prompt builder with
  spec's revised-prompt text verbatim, `normalizeRecapText`, sentence-aware `enforceWordLimit`,
  `preflightRecap` with the gate/notification matrix, DI'd `generateRecapText` through the
  0.80.10 simple-completion path), plus `scripts/test-trim.ts`, `scripts/test-prompt.ts`,
  `scripts/test-gates.ts`.
- **Why**: the shared generation path all four triggers use.
- **Deps / Inputs**: 02 (C1 types), 01 (C5 notes: completeSimple location, reasoning option
  shape, auth fields).
- **Contracts**: implements C3; consumes C1.
- **Constraints & Context**: gate 1 trigger matrix (manual warns; auto/startup/compaction
  silent); gates 2–3 warn on every trigger; gate 4 self-quiescing persist+notify, save failure
  does not block generation. `reasoning` omitted for `off`. Ellipsis U+2026 appended without
  preceding space. Never retry for length. Pass through whatever credential fields the 0.80.10
  auth result exposes (per C5 notes).
- **Relevant existing code**: `src/index.ts:139-243` (current runRecap being decomposed — the
  behavior being preserved), `src/conversation.ts`, C5 notes.
- **Verification requirements**:
  1. Prior bun scripts stay green.
  2. Per source plan M2: test-trim (normalization, sentence trim, fallback word trim, at-limit
     untouched, ellipsis never adds a word, version numbers survive, `?!` runs, no
     terminators); test-prompt (dynamic limit, "50 words" absent, newest-explicit-state
     phrases present); test-gates (null-model matrix, missing model/auth warn on manual and
     auto, clamp persists+notifies exactly once, `reasoning` presence/absence, auth
     pass-through).
  3. Edge cases: empty text; limit 1; text of exactly limit words.
  4. Manual: none.
- **Covers**: AC-3 (gate logic), AC-5, AC-6 (generation-time clamp), AC-11.

### 04-settings-menu

- **What**: `source-plan_0_5_0.md` M4 in full — new `src/settings-menu.ts` to C4: one
  `ctx.ui.custom()` overlay, internal screen stack (main/model/thinking/auto/preset/
  customInput), exported pure reducers, `performSave` with the 7-step flow, plus
  `scripts/test-menu.ts`.
- **Why**: AC-1's interactive configuration without JSON editing.
- **Deps / Inputs**: 02 (C1 types + saveConfig), 01 (C5 notes: SelectList/Input/Container
  actual API, `getSelectListTheme`, whether items can be replaced in place — if not, rebuild
  the SelectList preserving the selection index).
- **Contracts**: implements C4; consumes C1.
- **Constraints & Context**: draft-only mutation until Save; Escape at main discards
  everything; submenu Escape pops without draft change; `applyModelSelection` applies
  model+clamp atomically; model list from `getAvailable()` only after `refresh()`; None row
  first; preselect draft ref or None; filter matches id, provider, and name (filter manually
  if `setFilter` only matches labels); vanished-model Save rejection keeps the menu open with
  nothing written; never touch Pi's active/default model (no `ModelSelectorComponent`).
  Presets per source plan M4. The menu module must not import `src/index.ts`.
- **Relevant existing code**: `src/index.ts:36-116` (widget/theme usage style; note current
  index.ts has no SelectList/menu code — `getSelectListTheme` comes from pi-coding-agent,
  index.d.ts:24), C5 notes, pi-tui d.ts files.
- **Verification requirements**:
  1. Prior bun scripts stay green; `eslint src/settings-menu.ts` clean.
  2. `scripts/test-menu.ts` per source plan M4: generic thinking storage with null model;
     atomic model+clamp; auto toggle preserves delay; `parseCustomNumeric` rejections (zero,
     negatives, floats, junk, unsafe); `performSave` vanished model → `{ok:false}` + zero
     saveConfig calls; success → normalized config + `clampedFrom`; reducers pure (no
     performSave call ⇒ zero saveConfig calls).
  3. Edge cases: draft model vanishing mid-menu (thinking falls back to full list; Save
     catches); empty available-model list.
  4. Manual: TUI walkthrough is deferred to task 05/whole-run verification and recorded if not
     performed.
- **Covers**: AC-1 (menu side), AC-4, AC-7.

### 05-index-rewrite

- **What**: `source-plan_0_5_0.md` M3 in full — rewrite `src/index.ts`: version-baseline guard,
  delete the four flags + overrides plumbing + startup no-model warning, cache
  `autoRecapEnabled`/`currentIdleDelaySeconds`, wire all four triggers through
  `preflightRecap`/`generateRecapText`, dispatch on `parseRecapCommand` (settings opens the
  task-04 menu; non-TUI notice via `ctx.hasUI`), typed setters per the source plan's dispatch
  table, new command description. First fully green tree.
- **Why**: converts the module work into the shipping extension.
- **Deps / Inputs**: 03 and 04 merged (C1–C4 all real); C5 notes.
- **Contracts**: consumes C1–C4. If a contract cannot work as pinned, escalate; do not reshape.
- **Constraints & Context**: runRecap call sequence per source plan M2 §"runRecap call
  sequence": dedup applies to `auto` only; failed gates render no widget, keep previous recap,
  leave `lastRecapEntryId` untouched; empty-conversation notice manual-only, before the
  spinner. `/recap model` persists unresolvable refs with a warning. Preserve existing alive/
  generation/leaf post-checks and widget rendering. Bare `/recap` ignores the Auto Recap
  toggle and Idle Delay.
- **Relevant existing code**: all of `src/index.ts` (531 lines), the four new modules, C5 notes.
- **Verification requirements**:
  1. `pnpm check`, `pnpm lint`, and every bun script pass — whole repo, first green tree.
  2. Update/extend scripts where index wiring changed observable pure behavior (most behavior
     tests live with tasks 02–04; this task's tests are the compile+suite gates).
  3. Edge cases: version guard path (guard blocks registration on old Pi — assert
     `isVersionAtLeast` usage via test-baseline; runtime path is inspection).
  4. Manual: `pi -p "hi"` non-TUI smoke if a real session is feasible in the worktree —
     otherwise record as not verified.
- **Covers**: AC-3 (no startup warning; manual/auto split), AC-5 (wiring), AC-12, AC-14
  (flags removed).

### 06-finish

- **What**: `source-plan_0_5_0.md` M5 — convert `scripts/test-extract.ts` to assertions, add
  `"test"` script to package.json chaining all bun scripts, update `AGENTS.md` (code map,
  commands) and `README.md` (new command surface, settings menu, config schema + migration
  note), bump version to 0.5.0.
- **Why**: AC-15 and release hygiene.
- **Deps / Inputs**: 05 (final module layout to document).
- **Contracts**: none new.
- **Constraints & Context**: README/AGENTS.md must use CONTEXT.md domain language. Docs
  artifacts (CONTEXT.md, docs/specs, docs/adr) are committed by the coordinator, not this
  task; this task may reference them from README. No marketing prose.
- **Relevant existing code**: `scripts/test-extract.ts`, `README.md`, `AGENTS.md`,
  `package.json`.
- **Verification requirements**:
  1. `pnpm check && pnpm lint && pnpm format:check && pnpm test` all pass.
  2. test-extract now asserts (recency cutoff, compaction handling, oversized message) and
     fails through assertions.
  3. Edge cases: `pnpm test` fails fast when any script fails.
  4. Manual: none.
- **Covers**: AC-15.

## Orchestration

(Coordinator-only; omitted from assignments.)

### Waves

- Wave 1: 01
- Wave 2: 02
- Wave 3: 03 ∥ 04 (parallel, both branch from run branch after 02 merges)
- Wave 4: 05
- Wave 5: 06

### Sync Points

- 01 → all: `<RUNDIR>/tasks/01-baseline-api-notes.md` (C5) quoted into assignments 02–05. If it
  contradicts a pinned contract's Pi types, coordinator re-pins before dispatching dependents.
- 02 → 03/04: merged C1/C2 source is the input; assignments point at the merged files.
- 03+04 → 05: merged modules; any deviations recorded in their reports get quoted into 05's
  assignment.

### Integration Verification

- After 02: `bun run scripts/test-config.ts test-commands.ts test-baseline.ts test-extract.ts`;
  `eslint src/config.ts src/commands.ts`. Repo-wide `pnpm check` expected red (old index.ts) —
  record, don't fix.
- After 03 ∥ 04 merges: both tasks' scripts plus 02's; check no cross-imports of index.ts;
  repo-wide check still expected red.
- After 05: full `pnpm check && pnpm lint` green plus all bun scripts — the integration gate.
- After 06: post-merge validation below.
- Coordinator commits the docs (CONTEXT.md, docs/specs/, docs/adr/) onto the run branch after
  plan approval, before wave 1, so README references resolve.

### Post-Merge Validation

```bash
pnpm check && pnpm lint && pnpm format:check && pnpm test
bun run scripts/test-baseline.ts   # explicit baseline assertion
```

Browser verification: not applicable (terminal TUI extension, no web UI). Recorded as such.

## Project Tooling

- Install: `pnpm install` (safe-chain wrapper; add `--safe-chain-skip-minimum-package-age` if a
  fresh version fails to resolve)
- Build: none
- Test: `bun run scripts/<script>.ts` per script; `pnpm test` once task 06 adds it
- Lint: `pnpm lint` (`eslint src/`)
- Typecheck: `pnpm check` (`tsc --noEmit`)
- Format check: `pnpm format:check` (`prettier --check .`)
- Format write: `pnpm format` (`prettier --write .`)
- Commit style: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, optional scope e.g.
  `feat(recap):`). Husky pre-commit runs lint-staged (prettier + eslint --fix on staged .ts).
