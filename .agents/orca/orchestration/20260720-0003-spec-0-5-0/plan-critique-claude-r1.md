# Plan critique — round 1 (claude)

Reviewed: `plan.md` against `spec_0_5_0.md`, `source-plan_0_5_0.md`, `CONTEXT.md`, and the three
scout reports. Focus: decomposition seams, requirement coverage, correctness against the spec,
verification adequacy, sizing in both directions. Out of scope: implementation detail, style,
scope expansion.

## Summary

The plan is fundamentally sound: contracts C1–C5 are pinned with real signatures, the migration
truth tables match the spec exactly, the module-per-task seams have no file overlap in the one
parallel wave, and the settled human decisions are carried through. No requirement is
unassigned and no contract is circular or unimplementable. The weaknesses cluster in two places:
(1) the tree is deliberately red from wave 2 through wave 4 with no substitute typecheck gate, so
three tasks write TypeScript that nothing typechecks until task 05; and (2) task 05 is
simultaneously the largest task, the integration point for everything upstream, and the task with
the weakest verification of its own new behavior. Ten findings: 0 BLOCKING, 4 RISKY, 6 NOTE.

## Findings

### F1 — No typecheck gate on new modules until task 05

- **Plan section**: tasks 02, 03, 04 "Verification requirements"; "Integration Verification".
- **Failure scenario**: Tasks 02–04 gate on bun scripts plus per-file eslint. Bun strips types
  without typechecking. ESLint's typed rules do not report plain TypeScript compile errors
  (wrong argument count, misread 0.80.10 signature, bad narrowing); they only surface some type
  misuse indirectly. Repo-wide `pnpm check` is declared "expected red" after 02 and still red
  after the 03∥04 merge. So the first time `src/config.ts`, `src/commands.ts`,
  `src/generate.ts`, and `src/settings-menu.ts` are ever typechecked is task 05's first green
  tree. Concrete failure: task 03 misreads the C5 notes and calls `completeSimple` with a
  0.74.0-shaped options object; test-gates passes because the completion fn is a capturing fake
  and bun never typechecks; task 05 inherits a wall of type errors it does not own, in the
  module it is least equipped to fix, at the most expensive point of the critical path. The
  builder then either silently reshapes C3 (contract drift without a coordinator re-pin, which
  the plan forbids) or escalates and stalls wave 4. Cheap remediations exist: require tasks
  02–04 to typecheck their new modules via a scoped tsconfig (include only the new files and
  their imports), or direct task 02 to keep compile shims for the old index.ts imports so
  `pnpm check` stays meaningful throughout.
- **Severity**: RISKY

### F2 — Parallel tasks 03/04 are not forbidden from touching `src/index.ts`

- **Plan section**: tasks 03 and 04 "Constraints & Context"; "Waves" (wave 3).
- **Failure scenario**: Task 02 carries the explicit note that index.ts will not compile and
  that this is expected. Tasks 03 and 04 branch from that red tree but carry no equivalent
  constraint: 04 says the menu module must not _import_ index.ts, and 03 says nothing. A
  conscientious builder's default instinct when handed a tree where `pnpm check` fails is to
  make it compile. If either (or both) of the wave-3 builders "helpfully" patch index.ts's
  broken imports, you get: a merge conflict between 03 and 04 in a file neither owns, partial
  index rewrites smuggled in ahead of task 05's pinned design, and an integration check
  ("no cross-imports of index.ts") that does not detect the problem because it checks imports,
  not modifications. One sentence per task fixes this: "do not modify src/index.ts; the red
  `pnpm check` is expected and is task 05's to resolve."
- **Severity**: RISKY

### F3 — Task 05 concentrates the run's risk and has the weakest verification of its own behavior

- **Plan section**: task 05 "What" / "Verification requirements"; sizing.
- **Failure scenario**: Task 05 rewrites all 531 lines of index.ts: the version guard, deletion
  of four flags and the overrides plumbing, the timer cache, four trigger wirings, and a
  nine-branch dispatch table where several branches have intricate pinned semantics (`model`:
  refresh, find, clamp, single combined persist, conditional clamp notify, and persist-anyway
  with warning on miss; `thinking`: two modes depending on whether a model is configured). It is
  also where every upstream latent defect surfaces (F1). Yet its verification is "the compile+
  suite gates": every listed test re-runs _upstream modules'_ assertions; none asserts 05's own
  new behavior. The runRecap ordering rules the spec cares about (dedup applies to auto only;
  a failed gate renders no widget, keeps the previous recap, leaves `lastRecapEntryId`
  untouched; empty-conversation notice is manual-only and pre-spinner) are exactly the
  "behavior that is not obvious by inspection" the spec's verification section demands tests
  for, and they have zero assertion coverage because index.ts has no DI seam (scout-tests
  confirms). The manual fallback, `pi -p "hi"`, does not exercise `/recap` at all. Concrete
  failure: the `thinking` branch persists the raw level without the clamp when a model is
  configured; `pnpm check`, `pnpm lint`, and all eight bun scripts stay green; AC-6's
  setter-path half ships broken and nothing in the run can notice. Remediation options within
  plan scope: require 05 to expose the dispatch/runRecap orchestration behind the same DI style
  as `preflightRecap` and assert the ordering rules in a script, or at minimum replace the
  vacuous smoke with an explicit per-spec-bullet inspection checklist in 05's report so the
  coordinator signs off on named behaviors, not a green suite.
- **Severity**: RISKY

### F4 — The spec's "Existing behavior retained" section is invisible to the coverage model

- **Plan section**: "Requirements & Acceptance Criteria"; task 05 "Constraints & Context".
- **Failure scenario**: The plan enumerates AC-1..AC-15 and drives completion off that table,
  but the spec's "Existing behavior retained" section (widget above the editor; resume/fork and
  compaction recaps; previous successful recap remains visible if refresh fails; empty
  conversation and empty response keep producing feedback) is represented only as one
  constraints line inside task 05 ("Preserve existing alive/generation/leaf post-checks and
  widget rendering") with no AC number, no covering row, and no verification hook. Concrete
  failure: the rewrite drops the resume/fork `session_start` recap trigger or clears
  `lastRecapText` on a failed refresh; every AC in the table is genuinely satisfied; the
  coordinator's completion check reports full coverage and the regression ships. These retained
  behaviors should be first-class requirements (AC-16 or an explicit retained-behavior
  checklist in 05's verification), because per-AC signoff is the plan's only completion
  instrument.
- **Severity**: RISKY

### F5 — The 01→02 seam is thin; merging would cut a wave

- **Plan section**: "Tasks" table, "Waves".
- **Failure scenario** (coordination-cost direction of sizing): Task 02 consumes from task 01
  only "0.80.10 is installed" and a two-export stub (`isVersionAtLeast`,
  `REQUIRED_PI_VERSION`) that 02 must then preserve while rewriting the very same file. C1/C2
  are almost API-independent (config.ts touches only `getAgentDir`/SettingsManager), so the C5
  de-risking mostly serves tasks 03/04, which sit a wave later regardless. Splitting one
  139-line file's rewrite across two sequential dispatches buys a full dispatch round-trip and
  a split-file handoff for little isolation value. Merging 01+02 yields 01+02 → 03∥04 → 05 → 06
  (four waves, five tasks) with the C5 artifact still produced before any dependent dispatch.
  Not blocking: the current shape is defensible if the coordinator wants the API-verification
  checkpoint isolated for re-pinning, but the plan should own that trade-off explicitly.
- **Severity**: NOTE

### F6 — "The spec wins" collides with the spec making factual API claims

- **Plan section**: "Overview" (precedence rule); "Assumptions/Open"; C5.
- **Failure scenario**: The spec asserts as fact that 0.80.10 exports `completeSimple` from
  `@earendil-works/pi-ai/compat`; scouting could only verify 0.74.0, where it is a root export.
  If 0.80.10 keeps the root export, the spec's sentence is simply wrong about reality, and the
  plan's blanket rule "where this plan, the source plan, and the spec disagree, the spec wins"
  points a literal-minded task-03 builder at a nonexistent import path. The C5 artifact plus the
  coordinator re-pin path do handle this, but only if the builder classifies the conflict as a
  contract issue rather than a spec-precedence issue. One clause fixes it: the spec wins on
  _behavior_; the installed `.d.ts` files (as recorded in C5) win on _API surface_.
- **Severity**: NOTE

### F7 — AC-4 and the flags half of AC-14 are inspection-only negatives

- **Plan section**: task 04 "Covers" (AC-4); task 05 "Covers" (AC-14).
- **Failure scenario**: "No menu action changes Pi's active or default model or thinking level"
  and "all `--recap-*` flags removed" are negatives no assertion in this architecture can
  establish; both rest entirely on inspection (no `ModelSelectorComponent` import, no
  `registerFlag` calls). That is acceptable, but the plan nowhere requires the 04/05 reports to
  state these inspections explicitly, so the coordinator's AC checklist can be ticked without
  anyone having actually looked. Require the inspection to be a named line item in each
  report.
- **Severity**: NOTE

### F8 — Coverage-table attribution gaps

- **Plan section**: "Tasks" table `covers` column.
- **Failure scenario**: AC-1 is attributed only to 04, but the `/recap settings` dispatch and
  non-TUI notice in 05 are the last mile of "configure without editing JSON"; AC-6 is
  attributed only to 03, but the menu-Save clamp (04) and typed-setter clamp (05) are equally
  how unsupported levels are prevented from persisting silently; AC-11 is attributed only to
  03, but `enforceWordLimit` only takes effect through 05's runRecap step 7 wiring. The
  behaviors are present in the task bodies, so the risk is confined to signoff: a per-AC
  completion review consults the wrong single task's report and declares an AC verified on
  partial evidence.
- **Severity**: NOTE

### F9 — Task 02's shim discretion makes the wave-3 starting tree nondeterministic

- **Plan section**: task 02 "Constraints & Context" ("keep the old exports it needs only if
  trivially cheap, otherwise let `pnpm check` fail").
- **Failure scenario**: Whether index.ts half-compiles or fully fails after 02 is left to the
  02 builder's judgment, so assignments for 03/04/05 written in advance describe a tree state
  that may not match reality, and 05's estimate of its own integration burden is unknowable at
  planning time. Harmless if the coordinator records which path 02 took in the wave-2 sync and
  quotes it into the dependent assignments; the plan should say so.
- **Severity**: NOTE

### F10 — The deferred TUI walkthrough never lands anywhere

- **Plan section**: task 04 "Manual" ("deferred to task 05/whole-run verification"); task 05
  "Manual"; "Post-Merge Validation".
- **Failure scenario**: 04 defers the TUI walkthrough forward; 05's manual step is the
  non-TUI `pi -p` smoke; Post-Merge Validation contains only the command gates plus a
  browser-N/A note. The settled human decision requires anything not manually verified to be
  _recorded_ as such, never silently omitted, but no plan section owns making that record. As
  written, the walkthrough is silently dropped rather than explicitly declared unverified.
  Add one line to Post-Merge Validation: attempt the TUI walkthrough if feasible, otherwise
  record it as not manually verified in the final report.
- **Severity**: NOTE

## Coverage check

Every spec section maps to at least one task: runtime baseline (01), configuration/migration
(02), commands (02/05), generation gates and prompt/trim (03), interactive settings and model
selector (04/05), verification suite and hygiene (06). AC-1 through AC-15 all appear in the
covers column. The only coverage-model defects are F4 (retained behaviors outside the AC table)
and F8 (attribution). The pinned truth tables, gate matrix, first-slash parsing, save
normalization, and Save flow were checked line-by-line against the spec: no correctness
contradictions found; the plan's recorded decisions (compaction grouped with silent, unknown
text is an error not a refresh, setters write the full normalized object, persist-unresolvable
model refs) are all spec-compatible extensions, properly flagged as decisions.

## Sizing

Fewer tasks: yes at one seam (F5, merge 01+02). Task 06 is small but justified as separate: it
keeps release hygiene out of the already-heavy 05. Too complex: task 05 is the outlier (F3):
it is the integration point, the largest rewrite, and the sink for every upstream latent type
error (F1), while carrying the thinnest verification of its own behavior. The 03∥04 parallel
seam itself is clean (disjoint files, shared inputs merged before branch).

## Verdict

**revise** — no blocking defect: decomposition, contracts, and requirement coverage are sound,
and every RISKY finding has a cheap, targeted remediation (scoped typecheck gates for 02–04; an
explicit do-not-touch-index.ts constraint for 03/04; a real verification story or named
inspection checklist for 05's own behavior; retained behaviors promoted into the coverage
model). Apply those edits and proceed; a re-plan would discard a structure that is mostly
right.
