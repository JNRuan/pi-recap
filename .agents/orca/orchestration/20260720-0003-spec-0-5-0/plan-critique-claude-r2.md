# Plan critique — round 2 (claude)

Reviewed: revised `plan.md` (modified 2026-07-20T00:35Z) against `spec_0_5_0.md`,
`source-plan_0_5_0.md`, `CONTEXT.md`, the scout reports, the round-1 triage record, and my
round-1 critique. Focus: adequacy of the round-1 remediations and defects the revision itself
introduced. Out of scope: implementation detail, style, scope expansion, relitigating sound
triage decisions.

## Summary

The revision is a genuine improvement, not a paper one: the 01+02 merge removes the thin seam
without losing the API-verification checkpoint (C5-before-feature-code survives as an intra-task
rule), C7 pins real behavior that was genuinely undefined, the precedence clause resolves the
spec-vs-API collision cleanly, AC-16 makes retained behavior first-class, and the scoped
typecheck gate plus do-not-touch-index constraints close round 1's red-tree holes. The
remaining weaknesses concentrate in the two biggest new artifacts: `scripts/test-index.ts` is
specified with assertions that cannot be written against the pinned contracts without DI seams
the plan never names (and without a settings seam it would read and write the developer's real
`~/.pi/agent/settings.json`), and one accepted round-1 remediation (AC-11's index-side coverage)
was dropped between triage and plan text. Eight findings: 0 BLOCKING, 2 RISKY, 6 NOTE.

## Round-1 remediation adequacy

- **C6 load-safe guard** (codex #1): right mechanism (static-import allowlist + dynamic import
  post-guard + named inspection line). Residual gaps: the guard-path test is unimplementable as
  worded without unpinned seams (F1), the allowlist has a factual slip (F4), and it may collide
  with retained widget rendering (F5).
- **Controller-layer menu tests** (codex #2): adequate in design — real components, key events,
  the exact Escape/Save/rejected-Save matrix AC-7 needs. One unverified premise: headless
  constructibility of pi-tui components (F7).
- **test-index harness** (codex #3, claude F3): the assertion list is well-chosen and maps to
  AC-16 and the dispatch semantics. The gap is feasibility pinning, not coverage (F1), plus one
  dropped assertion (F2).
- **C7** (codex #4): sound; spec-compatible (the spec leaves configured-but-unresolvable
  undefined), AC-6 preserved by generation-time and Save-time clamps. No residual concern.
- **Prompt/identity assertions** (codex #5): full-string prompt comparison is right. The
  completeSimple identity assertion needs the default dep exported to be observable — another
  unnamed seam, folded into F1.
- **Chained bun runs** (codex #6): fixed correctly.
- **01+02 merge** (codex #7 first half, claude F5): correct call; wave count drops to 4 and the
  checkpoint survives. One new over-constraint introduced (F8).
- **All-three-packages baseline assertion** (codex #8): fixed correctly (resolved installed
  versions, not peer metadata).
- **Scoped typecheck gate** (claude F1): right mechanism; two small residuals (F3, F6).
- **Do-not-modify-index constraints + git-log check** (claude F2): fixed correctly, including
  the verification via `git log` on the file.
- **AC-16** (claude F4): added as first-class and covered by 04; the unreachable residue of
  AC-16 (e.g. widget-above-editor placement) has no named report line, unlike the other
  inspection-only negatives — minor, folded into F1's remediation ask.
- **Precedence clause, named inspection lines, covers broadening, shim-discretion removal,
  TUI-walkthrough ownership** (claude F6–F10): all fixed as accepted, except the covers
  broadening dropped AC-11 (F2).

## Findings

### F1 — test-index's pivotal assertions presume DI seams no contract pins, and without a settings seam the harness touches the developer's real global settings

- **Plan section**: task 04 "What" / "Verification requirements" 2–3; C6 verification.
- **Failure scenario**: Several of test-index's named assertions cannot be written against the
  contracts as pinned. (a) The version-guard edge case says "with the harness faking an old
  `VERSION`" — but VERSION is a static import from pi-coding-agent inside the module under
  test; a plain `bun run` script (not `bun test`, so no module mocking) cannot change what the
  real extension sees without an injectable-version seam. (b) "No dynamic module import occurs"
  is unobservable from outside unless the dynamic import goes through an injectable loader.
  (c) The real extension loads config via `SettingsManager.create(ctx.cwd)` and saves via
  `saveRecapConfig` defaulting to `getAgentDir()` — with no settings seam, the harness's setter
  assertions (`/recap delay`, `/recap auto off`) would **read and write the developer's real
  `~/.pi/agent/settings.json`**, making the test environment-dependent and mutating real user
  state. (d) Timer assertions need the pinned-nowhere "controllable timers". (e) Task 02's
  completeSimple identity assertion requires the default completion dep to be exported, which
  C3 does not include. The plan's license ("structure the wiring so the extension's behavior is
  drivable by a fake-context harness") lets a strong builder invent all five seams — but if any
  one proves awkward, the failure mode is silent: the builder ships a weaker assertion (e.g. a
  re-test of `isVersionAtLeast` instead of the guard path, or setter tests that skip
  persistence), the script is green, and the coordinator's integration gate cannot tell a
  strong assertion from a vacuous one. That would hollow out the exact remediation that
  resolved round 1's BLOCKING findings. Remediation: name the required seams in task 04's
  assignment (injectable version string, injectable module loader or an equivalent observable,
  injectable settings source/agentDir routed to a temp dir, injectable timers) and in task 02's
  (exported default completion dep); require 04's report to name any listed assertion that had
  to be weakened or dropped, alongside the existing named inspection lines (extend the same
  rule to AC-16 behaviors test-index cannot reach, such as widget placement).
- **Severity**: RISKY

### F2 — AC-11's index-side remediation was accepted in triage but dropped from the plan

- **Plan section**: "Tasks" table covers column (04); task 04 verification requirement 2;
  triage record "Coverage attribution gaps (AC-1/6/8/11 single-task)" row.
- **Failure scenario**: The triage record accepts the round-1 attribution finding naming AC-11,
  but the executed edit broadened only AC-1/6/8/13: task 04's covers column omits AC-11 and
  test-index's assertion list has no oversized-response case. `enforceWordLimit` and
  `normalizeRecapText` only take effect through runRecap step 7 wiring. Concrete failure: task
  04 renders the completion result without applying `enforceWordLimit`; every listed test-index
  assertion passes (none feeds an oversized fake completion), task 02's unit tests stay green
  (they test the pure function, not the wiring), `pnpm check`/`lint`/`test` are green, and
  AC-11's "configured maximum length" half ships broken with the AC table showing full
  coverage. One-line fix: add to test-index "an oversized fake completion result is normalized
  and trimmed per the configured word limit in the rendered widget" and add AC-11 to 04's
  covers row.
- **Severity**: RISKY

### F3 — Wave-2 parallel tasks both edit `tsconfig.modules.json`

- **Plan section**: tasks 02 and 03 "What" ("Add the new files to `tsconfig.modules.json`");
  "Waves".
- **Failure scenario**: Both wave-2 tasks append entries to the same small `files` array that
  task 01 created, at the same tail position — a near-guaranteed textual merge conflict in the
  one file both tasks are told to modify, mildly ironic given the revision's care to keep
  parallel tasks out of shared files. Trivial for the coordinator to resolve, but avoidable for
  free: have 01 write `include` globs (`src/*.ts` minus index via `exclude`, `scripts/*.ts`)
  so 02/03 never touch the file, or pre-list the known future filenames in 01.
- **Severity**: NOTE

### F4 — C6's parenthetical misattributes the `getAgentDir` import to `src/commands.ts`

- **Plan section**: C6.
- **Failure scenario**: C6 reads "`src/commands.ts` (whose only Pi import is `getAgentDir`)".
  Per scout-code, `getAgentDir` is imported by `src/config.ts` (config.ts:2); C2's commands
  module is pure parsing with no Pi imports at all. A literal-minded 01 builder could read the
  parenthetical as prescriptive and add a pointless `getAgentDir` import to commands.ts, or —
  worse — doubt the allowlist's accuracy wholesale and improvise. One-word fix: move the
  parenthetical to `src/config.ts`.
- **Severity**: NOTE

### F5 — C6's static-import allowlist may collide with retained widget rendering

- **Plan section**: C6; task 04 "Constraints & Context" (AC-16).
- **Failure scenario**: The allowlist permits static imports only from pi-coding-agent root,
  config.ts, and commands.ts. Scout evidence records index.ts's pi-ai import (`complete`,
  moving out) but not the full import list for the widget code (index.ts:36-116) — if
  `renderRecapWidget` statically imports pi-tui primitives or theme helpers, task 04 faces a
  contract that forbids an import a retained AC-16 behavior needs, and must either escalate
  (coordinator latency mid-wave-3) or restructure widget composition into a dynamically
  imported module (unpinned design change). Cheap pre-emption: either extend the allowlist to
  pi-tui root exports that exist at 0.74.0 (they cannot crash the guard on any Pi the guard
  targets), or state in task 04 that widget composition may move behind the dynamic boundary.
- **Severity**: NOTE

### F6 — Deleting `tsconfig.modules.json` may end typecheck coverage of `scripts/` entirely

- **Plan section**: task 04 "What" ("Delete `tsconfig.modules.json` once repo-wide `pnpm check`
  is green"); "Project Tooling".
- **Failure scenario**: Scout evidence does not record whether the root tsconfig's `include`
  covers `scripts/`; `pnpm lint` is `eslint src/` only. If the root config is src-scoped, then
  after 04 deletes the scoped config the nine test scripts are typechecked by nothing, forever
  — a type error introduced into a script by 04's own refactors or 05's test-extract conversion
  surfaces only as a runtime failure, or not at all on a code path bun happens not to execute.
  One-line fix: task 04 verifies `pnpm check` covers `scripts/` before deleting the scoped
  config (keep it otherwise).
- **Severity**: NOTE

### F7 — Headless constructibility of pi-tui components is assumed but not on C5's checklist

- **Plan section**: C4 (headless-drivable requirement); task 01 C5 scope (source-plan M0
  step 2); task 03 verification 2.
- **Failure scenario**: The controller layer — the remediation for round 1's second BLOCKING
  finding — requires constructing real SelectList/Input/Container instances and feeding key
  events with no terminal attached. C5 verifies export names and signatures, not runtime
  constructibility (a component that probes terminal width or requires a live TUI context at
  construction would pass every C5 check and still break the harness). If that surfaces, it
  surfaces mid-wave-2 as a task-03 escalation with no pinned fallback. Cheap insurance: add one
  line to task 01's C5 work — instantiate a SelectList and an Input under bun with no TTY and
  record that it works — so any problem is known before wave 2 dispatches.
- **Severity**: NOTE

### F8 — Task 01's escalate-before-feature-code rule over-blocks

- **Plan section**: task 01 "Constraints & Context".
- **Failure scenario**: "If the C5 notes contradict a pinned contract's Pi types, escalate
  before writing feature code" is written as an unconditional stop, but 01's own feature code
  (C1/C2) is almost Pi-independent — the realistic C5 discrepancies (completeSimple location,
  `max` in ThinkingLevel, SelectList details) affect only C3/C4, whose tasks the coordinator
  dispatches later anyway. As written, a SelectList signature surprise stalls 01's config/
  commands work on coordinator latency it does not need, lengthening the only fully serial
  wave. Fix: escalate immediately but continue M1 in parallel unless the contradiction touches
  C1/C2 (which would be surprising).
- **Severity**: NOTE

## New-artifact checks that came back clean

- 01+02 merge: no lost checkpoint; the C5-before-feature-code ordering and re-pin path survive;
  merged scope is large but dominated by pinned pure functions with truth tables — landable.
- C7: checked against the spec's typed-thinking rules; it fills a genuine hole without
  contradicting "otherwise they clamp against the configured model", and the AC-6 argument
  (storable but never silently effective) holds.
- Wave structure 01 → 02∥03 → 04 → 05: dependencies are real, the parallel pair is file-disjoint
  except for F3, and the integration checks per wave match what each wave can actually promise.
- Precedence clause, AC-16 wording, chained bun commands, all-three-packages baseline
  assertion, post-merge TUI-walkthrough recording: all correctly executed as triaged.

## Verdict

**revise** — no blocking defect and no structural problem: the round-1 remediations are the
right mechanisms, and the discard decision on splitting the index rewrite is sound and not
relitigated. But the two RISKY findings both sit inside the revision's own centerpiece
(test-index) — unpinned harness seams whose absence lets round 1's BLOCKING remediations
degrade silently, plus real-settings mutation risk, and one accepted remediation (AC-11
index-side) dropped between triage and plan. Both are assignment-text edits, not re-planning;
apply them (plus the one-line NOTEs as convenient) and dispatch.
