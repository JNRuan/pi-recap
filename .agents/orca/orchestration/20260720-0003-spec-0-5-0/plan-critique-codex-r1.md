# Plan critique: pi-recap 0.5.0

The module boundaries are mostly sensible, but the plan cannot yet establish that the release meets its central runtime and interactive requirements. The strongest failures are at the load boundary, the TUI controller, and the `index.ts` integration seam.

## 1. The runtime guard may never execute

- **Plan section:** Contracts C3; `01-baseline`; `05-index-rewrite`
- **Severity:** BLOCKING
- **Concrete failure scenario:** The planned generation module imports `completeSimple` from the 0.80.10 compatibility subpath, and `index.ts` consumes that module. Under the currently installed 0.74.0 API, that subpath is not exported. Static imports are resolved before `piRecap(pi)` runs, so an older Pi can fail while loading the extension and never reach the version guard that is supposed to register the friendly `session_start` error. `scripts/test-baseline.ts` exercises only the comparator and installed happy path, while task 05 explicitly leaves the runtime path to inspection.

The plan must define and verify a load-safe boundary, such as deferring all 0.80.10-only imports until after the guard, or stop claiming the runtime guard provides graceful enforcement and rely on install-time incompatibility instead.

## 2. The TUI behavior that carries AC-1 and AC-7 is not exercised

- **Plan section:** Assumptions, interactive walkthrough decision; `04-settings-menu`; Integration Verification
- **Severity:** BLOCKING
- **Concrete failure scenario:** A key-routing bug can make Escape on the main screen call Save, make submenu Escape mutate the draft, close the overlay after a rejected Save, or fail to route model-search input. Every proposed reducer and `performSave` assertion still passes because none drives the actual screen stack, `SelectList`, `Input`, or `done()` behavior. The only planned non-TUI smoke confirms the rejection notice, not the menu. This misses the spec's explicit verification of staged edits, Save persistence, Escape discard, searchable model selection, and configuration of every row.

Given the settled decision not to require a live walkthrough, task 04 needs an automated controller or fake-TUI harness that sends keys and observes draft, persistence, notification, and close behavior. Pure reducer tests are necessary but not a substitute for that boundary.

## 3. Task 05 has no behavioral integration test for the shipping extension

- **Plan section:** `05-index-rewrite`; Requirements and Acceptance Criteria; Post-Merge Validation
- **Severity:** BLOCKING
- **Concrete failure scenario:** `index.ts` can render the loading widget before a failed preflight, suppress bare `/recap` when Auto Recap is off, schedule an idle timer after `/recap auto off`, or fail to route `session_compact` through the shared path. The config, parser, gate, and menu unit scripts can all remain green because they never register the extension against a fake Pi API or invoke its handlers. Typecheck and lint prove none of these state transitions. AC-8 is also mapped only to task 02's config side even though disable, re-enable, timer clearing, and delay preservation are implemented in task 05.

Task 05 needs a fake extension/context harness with assertions over handler registration, triggers, widgets, notifications, model-call count, timer state, persistence, and preservation of the prior recap. Without it, AC-3, AC-5, AC-8, AC-12, AC-14, and several retained behaviors are claims by inspection.

## 4. Typed thinking has no defined behavior for a configured but unavailable model

- **Plan section:** `05-index-rewrite`, command dispatch for `model` and `thinking`
- **Severity:** BLOCKING
- **Concrete failure scenario:** The plan deliberately allows `/recap model provider/id` to persist a reference that `registry.find()` cannot resolve. A subsequent `/recap thinking high` enters the planned "model configured" branch, which says to resolve and clamp, but there is no model against which to call `clampThinkingLevel`. An implementation can crash, silently persist an unclamped value, or invent a fallback, each conflicting with the requirement that configured-model changes use an effective model-supported level and never leave unsupported levels silently effective.

The plan must choose the observable behavior for this reachable state and add a command-level assertion for it before task 05 is dispatched.

## 5. Generation tests do not prove two explicit contracts

- **Plan section:** `03-generate`, verification requirements
- **Severity:** RISKY
- **Concrete failure scenario:** A prompt that retains the two asserted phrases but omits the source-material safety instruction, the no-invention rule, or the one-paragraph/output-only constraints passes `test-prompt`, despite the plan requiring the spec text verbatim. Separately, a captured fake completion proves the shape of `reasoning` and credentials but not that the production default is the 0.80.10 model-agnostic compatibility function; the old `complete` path could remain behind the injection seam while the test stays green.

The prompt test should compare the complete expected contract after interpolation, and a module-boundary test should identify or exercise the real default completion dependency.

## 6. The post-task-02 integration command does not run the listed scripts

- **Plan section:** Orchestration, Integration Verification
- **Severity:** RISKY
- **Concrete failure scenario:** `bun run scripts/test-config.ts test-commands.ts test-baseline.ts test-extract.ts` runs `test-config.ts` and passes the remaining names as arguments. It does not execute the other three scripts. A broken command parser or baseline can therefore cross the 02 to 03/04 sync point and be discovered only after more work has accumulated.

Use separately chained `bun run` invocations or introduce the aggregate test script before this sync point.

## 7. The task sizing pays for a weak handoff, then concentrates the riskiest work

- **Plan section:** Tasks; Waves; `01-baseline`; `02-config-commands`; `05-index-rewrite`
- **Severity:** RISKY
- **Concrete failure scenario:** Tasks 01 and 02 are strictly serial, both edit `src/config.ts`, and task 01 unlocks no parallel work before task 02 completes. The second worker must preserve a helper added by the first while rewriting the same file, and both leave the repository knowingly red. In the other direction, task 05 must reconcile all four contracts, replace a 531-line lifecycle module, integrate the TUI, commands, timers, four triggers, widgets, persistence, and the version guard, and produce the first green tree, with no dedicated integration harness.

Either combine 01 and 02 while retaining API verification as the first internal gate, or keep task 01 artifact-only and move the config edit to task 02. Split task 05 into sequential, independently verified lifecycle/generation and command/menu/timer integration steps. This reduces both a coordination-only seam and the single largest landing risk.

## 8. Baseline verification checks only one installed Pi package

- **Plan section:** `01-baseline`, verification requirements
- **Severity:** RISKY
- **Concrete failure scenario:** The test asserts all three peer range strings but reads the installed `VERSION` only from `pi-coding-agent`. A lockfile with `pi-coding-agent` at 0.80.10 and stale `pi-ai` or `pi-tui` resolution can satisfy the test even though the spec requires all three runtime packages at 0.80.10 or newer. Peer metadata is not evidence of the installed resolution.

Assert the resolved versions of all three packages, preferably from their package metadata or the lockfile plus loadable exports.

## Verdict

**revise**

The design does not need wholesale replacement, but the blocking load, TUI, index-integration, and unavailable-model cases must be resolved before dispatch. The verification plan should then be tightened at the exact boundaries where stateful behavior currently escapes the pure tests.
