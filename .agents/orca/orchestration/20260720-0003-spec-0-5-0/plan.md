---
run: 20260720-0003-spec-0-5-0
source: docs/specs/spec_0_5_0.md
base: main
base_sha: d1e9d8c3e0934cd8d48a35ce338259347bc4ef45
branch: 20260720-0003-spec-0-5-0
plan_review_tier: medium
run_complexity: medium
created: 2026-07-20T00:10:52Z
modified: 2026-07-20T00:52:00Z
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

- `spec_0_5_0.md` — the spec (authoritative on **behavior**).
- `source-plan_0_5_0.md` — the human-written implementation plan (authoritative on design detail;
  its milestone sections M0–M5 are incorporated into the tasks below by direct reference).
- `CONTEXT.md` — domain language. User-facing text says "Recap Model", "Recap Thinking Level",
  "Auto Recap", "Idle Delay"; never "effort" or "interval".

Precedence: on **behavior**, the spec wins over this plan and the source plan. On **API
surface** (export locations, type unions, signatures), the installed `.d.ts` files as recorded
in the C5 notes win — the spec's API statements are predictions about 0.80.10, not requirements.
An API mismatch is a contract issue: escalate for a coordinator re-pin; never improvise. Note
every discrepancy in reports.

## Review Policy

- **Plan-critique cap used**: 2 (from `plan_review_tier: medium`); both rounds run, stopped at
  cap with round-2 accepted edits applied without re-critique.
- **Run-complexity rationale**: `medium`. Whole-extension rewrite but a single small subsystem
  with every design decision pinned by spec + source plan + contracts; no
  auth/payments/data-migration/concurrency primitives (an idle `setTimeout` only); failure
  impact limited to a dev-tool widget; observability strong after this run (typed, linted,
  ten assertion-based bun suites including behavioral harnesses for the menu controller and the
  wired extension). Critique rounds surfaced verification gaps, all closed by plan edits; no
  aggregate-risk signal above the ordinary-subsystem tier.
- **Code-review cap**: 2 (from `run_complexity: medium`)
- **Adversarial QA**: skip (run complexity policy: medium)

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

Supporting requirements (spec "Runtime baseline", "Commands", "Verification requirements",
"Existing behavior retained"):

- **AC-13**: Pi >= 0.80.10 baseline enforced (peer ranges, lockfile resolution of **all three**
  packages, load-safe runtime guard).
- **AC-14**: All `--recap-*` CLI flags removed; legacy subcommands rejected with migration hints.
- **AC-15**: The spec's verification list is covered by assertion-based bun scripts that fail
  through assertions, and `pnpm check && pnpm lint && pnpm format:check && pnpm test` passes.
- **AC-16** (spec "Existing behavior retained", first-class): the widget remains above the
  editor; manual, resume/fork, compaction, and Auto Recap share one generation path; Auto Recap
  requires uninterrupted inactivity for the full Idle Delay; Recent Messages counts visible
  user/assistant messages with compaction summaries as background; the previous successful
  recap remains visible if refresh fails; a configured-but-unavailable/unauthenticated model,
  an empty conversation, and an empty response continue to produce user-visible feedback.

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
    SelectList/Input/Container details, `getSelectListTheme` and `VERSION` exports, and
    **headless constructibility** of SelectList/Input under bun with no TTY. Task 01 records
    the verified surface in the C5 sync artifact all later tasks receive.
  - Whether the root tsconfig's `include` covers `scripts/` (decides `tsconfig.modules.json`'s
    end-of-life; see task 04).
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
Only empty/whitespace args yield `refresh`. Commands.ts is pure parsing: no Pi imports.

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
export const defaultCompletion: SimpleCompletionFn; // the real 0.80.10 simple-completion export, re-exported
export async function generateRecapText(...): Promise<string>;
// generateRecapText's completion dependency defaults to `defaultCompletion` (observable binding:
// tests assert defaultCompletion === the real pi-ai export, and inject fakes through the same seam).
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
Save order is observable: `saveConfig(draft)` then `onSaved(config)` then close — in that
order, asserted by the controller tests. The menu's `custom()` component must be drivable
headlessly: constructing it with fake deps and feeding key events through its input handler
must exercise the real screen stack, real pi-tui components, and real reducers without a live
terminal (this is how AC-7's Escape/Save semantics are asserted).

### C5 — sync artifact from task 01

Task 01 writes `<RUNDIR>/tasks/01-baseline-api-notes.md` **before writing any feature code**:
verified 0.80.10 exports and signatures for every item in `source-plan_0_5_0.md` M0 step 2,
each marked CONFIRMED-AS-SPEC / DIFFERS (with actual), plus two probes: (a) instantiate a
`SelectList` and an `Input` under bun with no TTY and record whether construction and
input-handling work headlessly; (b) record whether the root tsconfig's effective `include`
(via `tsc --showConfig`) covers `scripts/`.

### C6 — load safety (version guard must be reachable)

`src/index.ts`'s **static** imports are restricted to: `@earendil-works/pi-coding-agent` root
exports that exist at 0.74.0 (`VERSION`, `getAgentDir`, types), `@earendil-works/pi-tui` root
exports that exist at 0.74.0 (widget rendering needs them and they cannot crash the guard on
any Pi the guard targets), `src/config.ts` (whose only Pi import is `getAgentDir`), and
`src/commands.ts` (pure, no Pi imports). `src/generate.ts` and `src/settings-menu.ts` — the
modules touching version-sensitive pi-ai surface and menu composition — are loaded via
**dynamic `import()` after the version guard passes**. Type-only imports are exempt (erased at
runtime). This guarantees an older Pi reaches the guard's friendly `session_start` error
instead of crashing at module load. Task 04's report must include a named inspection line
confirming the static-import allowlist.

### C7 — typed `thinking` with a configured-but-unresolvable model (pinned behavior)

`/recap thinking <level>` when `recapModel` is non-null but `registry.find()` misses (after
`refresh()`): persist the valid stored level as-is and warn
`Recap: <provider>/<id> is not currently available; Recap Thinking Level <level> will be
clamped when the model is available.` No crash, no invented fallback. AC-6 stays satisfied
because every generation preflight (gate 4) and menu Save clamp against the resolved model
before any request; an unsupported level can be _stored_ but never silently _effective_.

### C8 — test-harness seams (task 04)

`scripts/test-index.ts` runs under plain `bun run` (no module mocking), so the wiring must
expose these injection seams — named here so their absence is a contract violation, not a
builder judgment call:

- **Version**: the guard reads an injectable version string (defaulting to the real `VERSION`)
  so the old-Pi path is testable.
- **Module loading**: the post-guard dynamic imports go through an injectable loader (default:
  real `import()`), so the harness can observe "no dynamic import occurred" on the old-Pi path
  and substitute fakes elsewhere if needed.
- **Settings**: config load/save paths accept an injectable settings source / agent dir. The
  harness routes ALL reads and writes to a temp directory — it must never touch the real
  `~/.pi/agent/settings.json`.
- **Timers**: idle scheduling accepts an injectable clock/timer facade (default: real
  setTimeout/clearTimeout) so inactivity behavior is assertable without wall-clock waits.
- **Completion**: via C3's `defaultCompletion` seam.

If any listed test-index assertion has to be weakened or dropped despite these seams, task
04's report must name it explicitly (same rule as the inspection-only negatives).

## Tasks

| seq | slug                     | deps   | complexity | builder           | covers                                                          |
| --- | ------------------------ | ------ | ---------- | ----------------- | --------------------------------------------------------------- |
| 01  | baseline-config-commands | —      | high       | codex sol · xhigh | AC-2, AC-8, AC-9, AC-10, AC-13, AC-14 (parsing)                 |
| 02  | generate                 | 01     | medium     | codex sol · high  | AC-3, AC-5, AC-6, AC-11                                         |
| 03  | settings-menu            | 01     | high       | codex sol · xhigh | AC-1, AC-4, AC-7                                                |
| 04  | index-rewrite            | 02, 03 | high       | codex sol · xhigh | AC-1, AC-3, AC-5, AC-6, AC-8, AC-11, AC-12, AC-13, AC-14, AC-16 |
| 05  | finish                   | 04     | medium     | codex sol · high  | AC-15                                                           |

Sizing decisions (round-1 critique): former tasks 01 and 02 merged — the seam was a serial
same-file handoff that unlocked no parallelism (both critics flagged it). The index rewrite
stays one task — splitting it would recreate exactly that same-file serial seam with an
unverifiable intermediate state; its landing risk is addressed with a behavioral harness
(`scripts/test-index.ts`) instead.

### 01-baseline-config-commands

- **What**: `source-plan_0_5_0.md` M0 + M1 in full, in that order. First M0: peer ranges to
  `">=0.80.10"`, upgrade all three Pi packages (lockfile updated), write the C5 API notes
  (including both probes) from the installed `.d.ts` files, `scripts/test-baseline.ts`. Then
  M1: rewrite `src/config.ts` to C1 (types, defaults, migration truth tables, global-only
  `loadRecapConfig`, `buildNormalizedPiRecap`, atomic `saveRecapConfig` preserving sibling
  top-level keys), new `src/commands.ts` to C2, `scripts/test-config.ts`,
  `scripts/test-commands.ts`, and the scoped typecheck config `tsconfig.modules.json`.
- **Why**: baseline plus the schema and grammar every other task builds against; C5 de-risks
  tasks 02–04.
- **Deps / Inputs**: none.
- **Contracts**: produces C5 (before feature code), implements C1 and C2 exactly.
- **Constraints & Context**: safe-chain wrapper may hide the new versions — use
  `--safe-chain-skip-minimum-package-age` or unwrapped pnpm if resolution fails. If the C5
  notes contradict a pinned contract's Pi types, **escalate immediately**; continue the M1
  config/commands work in parallel unless the contradiction touches C1/C2 themselves (it
  should not — they are almost Pi-independent). `tsconfig.modules.json` must produce a program
  containing ONLY the new-module files and scripts: extend `./tsconfig.json` but **explicitly
  replace the inherited input set** with `include: ["scripts/**/*.ts", "src/**/*.ts"]` and
  `exclude: ["src/index.ts", "src/conversation.ts"]` (globs tolerate files that do not exist
  yet, so tasks 02/03 never edit this file); verify the effective file list with
  `pnpm exec tsc --showConfig -p tsconfig.modules.json` and record it in the report. Delete
  the project-settings merge entirely; legacy `effort` never read; explicit `recapModel: null`
  blocks legacy inference; first-slash parsing replaces the multi-slash rejection
  (config.ts:78). Do **not** shim old exports for `src/index.ts` and do not modify
  `src/index.ts` or `src/conversation.ts`: repo-wide `pnpm check` is expected red until task
  04 and that is deterministic and recorded, not worked around. Gate instead on
  `pnpm exec tsc --noEmit -p tsconfig.modules.json` (must be green) plus
  `eslint src/config.ts src/commands.ts`.
- **Relevant existing code**: `package.json:15-19` (peer `"*"`), `pnpm-lock.yaml:11-20`,
  `src/config.ts` (all 139 lines), `src/index.ts:412-517` (current subcommand surface being
  replaced — read-only), `scripts/test-extract.ts` (bun script style),
  `node_modules/@earendil-works/*/dist/*.d.ts` post-upgrade.
- **Verification requirements**:
  1. `bun run scripts/test-extract.ts` still runs; `pnpm exec tsc --noEmit -p
tsconfig.modules.json` green with the recorded file list.
  2. `scripts/test-baseline.ts`: peer ranges assert `">=0.80.10"`; `isVersionAtLeast` matrix
     (`0.80.9` false; `0.80.10`, `0.81.0`, `1.0.0` true; prerelease-tolerant); **resolved
     installed versions of all three packages** (each package's own `package.json` version, not
     peer metadata) meet the baseline. `scripts/test-config.ts`: all 7 levels accepted,
     junk→`low`; `effort` ignored; the three migration truth tables incl. partial migration;
     delay preserved while auto disabled; `buildNormalizedPiRecap` exactly 6 keys; global-only
     loading via fake source (project values must have no effect); save round-trip in temp dir
     (obsolete keys removed, sibling keys preserved). `scripts/test-commands.ts`: all canonical
     forms; usage on missing values; first-slash multi-slash ids; `none`; legacy heads →
     `unknown` with hints; bare/whitespace → `refresh`; garbage → `unknown`.
  3. Edge cases: prerelease suffixes and unequal segment counts (version compare);
     `intervalSeconds: 0` → disabled + 300s delay; unsafe integers rejected; whitespace-only
     model strings.
  4. Manual: none.
- **Covers**: AC-2, AC-8 (config side), AC-9, AC-10, AC-13 (baseline + all-three-packages
  assertion), AC-14 (parsing side).

### 02-generate

- **What**: `source-plan_0_5_0.md` M2 in full — new `src/generate.ts` to C3 (prompt builder with
  spec's revised-prompt text verbatim, `normalizeRecapText`, sentence-aware `enforceWordLimit`,
  `preflightRecap` with the gate/notification matrix, `generateRecapText` with the
  `defaultCompletion` seam through the 0.80.10 simple-completion path), plus
  `scripts/test-trim.ts`, `scripts/test-prompt.ts`, `scripts/test-gates.ts`.
- **Why**: the shared generation path all four triggers use.
- **Deps / Inputs**: 01 (C1 types; C5 notes: completeSimple location, reasoning option shape,
  auth fields).
- **Contracts**: implements C3 (including the observable `defaultCompletion` binding); consumes
  C1; obeys C6 (this module owns the version-sensitive pi-ai imports; it is dynamically
  imported by index.ts, so its own imports may be static).
- **Constraints & Context**: gate 1 trigger matrix (manual warns; auto/startup/compaction
  silent); gates 2–3 warn on every trigger; gate 4 self-quiescing persist+notify, save failure
  does not block generation. `reasoning` omitted for `off`. Ellipsis U+2026 appended without
  preceding space. Never retry for length. Pass through whatever credential fields the 0.80.10
  auth result exposes (per C5 notes). **Do not modify `src/index.ts` or
  `tsconfig.modules.json`** — the red repo-wide `pnpm check` is expected and is task 04's to
  resolve; the scoped tsconfig's globs already cover this task's new files.
- **Relevant existing code**: `src/index.ts:139-243` (current runRecap being decomposed — the
  behavior being preserved; read-only), `src/conversation.ts`, C5 notes.
- **Verification requirements**:
  1. Prior bun scripts stay green; `pnpm exec tsc --noEmit -p tsconfig.modules.json` green.
  2. test-trim: normalization, sentence trim, fallback word trim, at-limit untouched, ellipsis
     never adds a word, version numbers survive, `?!` runs, no terminators. test-prompt:
     compare `buildRecapSystemPrompt(n)` against the **complete expected prompt string** (the
     spec's "Revised prompt" contract with the limit interpolated) for at least two limits;
     assert "50 words" absent. test-gates: null-model trigger matrix, missing model/auth warn
     on manual and auto, clamp persists+notifies exactly once (second run quiet), `reasoning`
     presence/absence via a fake injected through the same seam the default uses, auth
     pass-through, and the identity assertion `defaultCompletion === <real pi-ai
simple-completion export>`.
  3. Edge cases: empty text; limit 1; text of exactly limit words.
  4. Manual: none.
- **Covers**: AC-3 (gate logic), AC-5, AC-6 (generation-time clamp), AC-11.

### 03-settings-menu

- **What**: `source-plan_0_5_0.md` M4 in full — new `src/settings-menu.ts` to C4: one
  `ctx.ui.custom()` overlay, internal screen stack (main/model/thinking/auto/preset/
  customInput), exported pure reducers, `performSave` with the 7-step flow, plus
  `scripts/test-menu.ts`.
- **Why**: AC-1's interactive configuration without JSON editing.
- **Deps / Inputs**: 01 (C1 types + saveConfig; C5 notes: SelectList/Input/Container actual
  API, `getSelectListTheme`, headless-constructibility probe result, whether items can be
  replaced in place — if not, rebuild the SelectList preserving the selection index).
- **Contracts**: implements C4 including the headless-drivable requirement and the observable
  Save order (`saveConfig` → `onSaved` → close); consumes C1; obeys C6 (dynamically imported
  by index.ts; own imports may be static).
- **Constraints & Context**: draft-only mutation until Save; Escape at main discards
  everything; submenu Escape pops without draft change; `applyModelSelection` applies
  model+clamp atomically; model list from `getAvailable()` only after `refresh()`; None row
  first; preselect draft ref or None; filter matches id, provider, and name (filter manually
  if `setFilter` only matches labels); vanished-model Save rejection keeps the menu open with
  nothing written; never touch Pi's active/default model (no `ModelSelectorComponent`).
  Presets per source plan M4. The menu module must not import `src/index.ts` and **must not
  modify `src/index.ts` or `tsconfig.modules.json`** — the red repo-wide `pnpm check` is
  expected and is task 04's to resolve.
- **Relevant existing code**: `src/index.ts:36-116` (widget/theme usage style; current index.ts
  has no menu code — `getSelectListTheme` comes from pi-coding-agent, index.d.ts:24), C5
  notes, pi-tui d.ts files.
- **Verification requirements**:
  1. Prior bun scripts stay green; `pnpm exec tsc --noEmit -p tsconfig.modules.json` green;
     `eslint src/settings-menu.ts` clean.
  2. `scripts/test-menu.ts`, two layers. **Reducer layer** (source plan M4): generic thinking
     storage with null model; atomic model+clamp; auto toggle preserves delay;
     `parseCustomNumeric` rejections (zero, negatives, floats, junk, unsafe); `performSave`
     vanished model → `{ok:false}` + zero saveConfig calls; success → normalized config +
     `clampedFrom`. **Controller layer** (headless, real components, fake ui/registry/save
     deps) — the matrix traverses **all seven main rows**: Escape on main closes with zero
     `saveConfig` calls; staged edits then Escape discard everything; submenu Escape pops
     without draft mutation; Enter on Save with a valid draft calls `saveConfig` exactly once,
     then `onSaved` with the saved config, then closes — asserted in that order, including a
     draft that disables Auto Recap and changes Idle Delay through the menu; rejected Save
     (vanished model) notifies, keeps the menu open, writes nothing; model-search input routes
     to the filter and narrows the list for **three separate queries: by id, by provider, by
     model name**; selecting a model updates the draft label and clamps the draft thinking
     level; the **thinking screen** offers `getSupportedThinkingLevels` choices with a
     configured draft model and all levels with a null draft model, and selection updates the
     draft; the **Auto Recap screen** toggles the draft both ways preserving the delay; each
     of the **three preset screens** (Idle Delay, Recent Messages, Maximum Words) applies a
     preset to the correct field; **Custom input** per field: valid submit applies and pops,
     invalid input shows the inline error with draft unchanged and dialog open, Escape cancels
     with draft unchanged.
  3. Edge cases: draft model vanishing mid-menu (thinking falls back to full list; Save
     catches); empty available-model list.
  4. Manual: none required beyond the controller tests; anything they cannot reach is named in
     the report.
- **Covers**: AC-1 (menu side), AC-4 (report must contain a named inspection line: no
  `ModelSelectorComponent`, no writes to Pi's model/thinking settings), AC-7.

### 04-index-rewrite

- **What**: `source-plan_0_5_0.md` M3 in full — rewrite `src/index.ts`: load-safe version guard
  per C6, delete the four flags + overrides plumbing + startup no-model warning, cache
  `autoRecapEnabled`/`currentIdleDelaySeconds`, wire all four triggers through
  `preflightRecap`/`generateRecapText`, dispatch on `parseRecapCommand` (settings opens the
  task-03 menu; non-TUI notice via `ctx.hasUI`), typed setters per the source plan's dispatch
  table plus C7, new command description. Build the C8 seams into the wiring and write
  `scripts/test-index.ts` against them. End-of-life for `tsconfig.modules.json`: consult C5's
  probe — if the root tsconfig covers `scripts/`, delete the scoped config once repo-wide
  `pnpm check` is green; if it does not, keep the scoped config and extend the `check` script
  to chain it (scripts must not lose typecheck coverage). First fully green tree.
- **Why**: converts the module work into the shipping extension.
- **Deps / Inputs**: 02 and 03 merged (C1–C4 all real); C5 notes; deviations from their reports
  quoted in the assignment.
- **Contracts**: consumes C1–C4; implements C6, C7, and C8. If a contract cannot work as
  pinned, escalate; do not reshape.
- **Constraints & Context**: runRecap call sequence per source plan M2 §"runRecap call
  sequence": dedup applies to `auto` only; failed gates render no widget, keep previous recap,
  leave `lastRecapEntryId` untouched; empty-conversation notice manual-only, before the
  spinner. `/recap model` persists unresolvable refs with a warning; `/recap thinking` per C7.
  Preserve existing alive/generation/leaf post-checks and widget rendering. Bare `/recap`
  ignores the Auto Recap toggle and Idle Delay. AC-16 behaviors are requirements, not
  incidentals.
- **Relevant existing code**: all of `src/index.ts` (531 lines), the four new modules, C5 notes.
- **Verification requirements**:
  1. `pnpm check`, `pnpm lint`, and every bun script pass — whole repo, first green tree.
  2. `scripts/test-index.ts`: a fake Pi extension-context harness built on the C8 seams (fake
     `pi` registration surface, `ctx.ui` recorder, fake registry/auth, fake session entries,
     injected fake completion, temp-dir settings, fake timers) that registers the real
     extension and asserts at minimum:
     - null-model manual `/recap` warns with **no widget change and no model call**, while
       auto/startup/compaction skip silently;
     - a failed gate leaves the previous recap text and `lastRecapEntryId` untouched;
     - dedup suppresses only `auto` re-runs at the same leaf; bare `/recap` refreshes with
       `autoRecapEnabled: false`;
     - `/recap auto off` clears the idle timer and preserves the delay, `auto on` reschedules;
       `/recap delay` updates the cached delay without touching the enabled flag;
     - **inactivity semantics**: `input`/`turn_start` activity resets the idle timer, and Auto
       Recap does not fire before one full uninterrupted Idle Delay (fake timers);
     - the `thinking` setter clamps against a resolvable model, persists the effective level,
       and follows C7 when the model is unresolvable; `/recap model` persists an unresolvable
       ref with a warning;
     - **every remaining canonical command**: `/recap settings` in non-TUI mode notifies the
       TUI-required message (and does not open a menu or generate); `/recap config` reports
       the effective config in canonical terms; `/recap messages` and `/recap words` persist
       immediately; `usage` results (setter without value) and `unknown` results (garbage and
       each legacy head with its migration hint) reach the UI as warnings and trigger **no
       generation**;
     - `session_compact` routes through the shared path; **resume/fork startup with a
       configured, available model generates a recap** (fake completion called);
     - manual `/recap` on an empty conversation notifies "nothing to recap" pre-spinner;
     - a successful generation renders the widget; an empty response warns while keeping the
       previous recap; an **oversized fake completion result is normalized and trimmed per
       the configured word limit in the rendered widget** (AC-11 wiring);
     - version-guard path: with an injected old version string, registration stops after the
       friendly `session_start` error and the injectable loader observes **no dynamic module
       import**.
  3. Edge cases: covered by the harness list above (guard path, empty conversation, empty
     response, oversized response).
  4. Manual: `pi -p "hi"` non-TUI smoke if feasible — otherwise record as not verified. The
     report must contain named inspection lines for: zero `registerFlag` calls (AC-14), the
     C6 static-import allowlist, no writes to Pi's model/thinking settings (AC-4), and
     widget-above-editor placement (AC-16's inspection-only residue); plus explicit naming of
     any test-index assertion that was weakened or dropped (C8).
- **Covers**: AC-1 (settings dispatch + non-TUI notice), AC-3, AC-5, AC-6 (setter path),
  AC-8 (runtime side), AC-11 (wiring), AC-12, AC-13 (load-safe guard), AC-14, AC-16.

### 05-finish

- **What**: `source-plan_0_5_0.md` M5 — convert `scripts/test-extract.ts` to assertions, add
  `"test"` script to package.json chaining all bun scripts, update `AGENTS.md` (code map,
  commands) and `README.md` (new command surface, settings menu, config schema + migration
  note), bump version to 0.5.0.
- **Why**: AC-15 and release hygiene.
- **Deps / Inputs**: 04 (final module layout to document; whether `tsconfig.modules.json`
  survived and how `check` chains it).
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
- Wave 2: 02 ∥ 03 (parallel, both branch from run branch after 01 merges)
- Wave 3: 04
- Wave 4: 05

### Sync Points

- 01 → 02/03/04: `<RUNDIR>/tasks/01-baseline-api-notes.md` (C5) quoted into dependent
  assignments. If it contradicts a pinned contract's Pi types, coordinator re-pins before
  dispatching dependents. 01's report also records the actual post-01 tree state (which
  repo-wide checks are red and why) and the two C5 probe results — quoted into 02/03
  assignments so their builders expect it.
- 02+03 → 04: merged modules; any deviations recorded in their reports get quoted into 04's
  assignment.

### Integration Verification

- After 01 (chained, not space-separated):
  `bun run scripts/test-baseline.ts && bun run scripts/test-config.ts && bun run
scripts/test-commands.ts && bun run scripts/test-extract.ts`;
  `pnpm exec tsc --noEmit -p tsconfig.modules.json`; `eslint src/config.ts src/commands.ts`.
  Repo-wide `pnpm check` expected red (old index.ts) — record, don't fix.
- After 02 ∥ 03 merges: both tasks' scripts plus 01's (each via its own `bun run`); scoped
  tsconfig green; verify `src/index.ts` and `tsconfig.modules.json` untouched by 02/03
  (`git log` on both files); repo-wide check still expected red.
- After 04: full `pnpm check && pnpm lint` green plus all bun scripts (incl. test-index) —
  the integration gate; `tsconfig.modules.json` deleted or chained per C5's probe.
- After 05: post-merge validation below.
- Coordinator commits the docs (CONTEXT.md, docs/specs/, docs/adr/) onto the run branch after
  plan approval, before wave 1, so README references resolve.

### Post-Merge Validation

```bash
pnpm check && pnpm lint && pnpm format:check && pnpm test
bun run scripts/test-baseline.ts   # explicit baseline assertion
```

Browser verification: not applicable (terminal TUI extension, no web UI). Recorded as such.
Attempt an interactive TUI walkthrough of `/recap settings` only if a real TUI session is
feasible; otherwise the coordinator records it as **not manually verified** in `summary.md`
and the PR (per the settled human decision) — it is never silently dropped.

## Project Tooling

- Install: `pnpm install` (safe-chain wrapper; add `--safe-chain-skip-minimum-package-age` if a
  fresh version fails to resolve)
- Build: none
- Test: `bun run scripts/<script>.ts` per script; `pnpm test` once task 05 adds it
- Lint: `pnpm lint` (`eslint src/`)
- Typecheck: `pnpm check` (`tsc --noEmit`); scoped gate during waves 1–2:
  `pnpm exec tsc --noEmit -p tsconfig.modules.json`
- Format check: `pnpm format:check` (`prettier --check .`)
- Format write: `pnpm format` (`prettier --write .`)
- Commit style: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, optional scope e.g.
  `feat(recap):`). Husky pre-commit runs lint-staged (prettier + eslint --fix on staged .ts).
