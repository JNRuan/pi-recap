# Round-2 plan critique: pi-recap 0.5.0

The revision resolves several round-1 design ambiguities, but its new verification structure still has one mechanically broken gate and leaves important TUI, command, and retained-runtime behavior outside the asserted paths.

## 1. The scoped typecheck is not scoped

- **Plan section:** `01-baseline-config-commands`; `02-generate`; `03-settings-menu`; Integration Verification
- **Severity:** BLOCKING
- **Concrete failure scenario:** The plan says `tsconfig.modules.json` extends `tsconfig.json` and sets `files` to the new modules and scripts, without overriding the base `include`. TypeScript combines those input sources. The repository's base config includes `src/**/*.ts` and `scripts/**/*.ts`, so the resulting program still contains `src/index.ts`, `src/conversation.ts`, and every script. After task 01 removes the legacy config exports, the old index errors remain in the supposedly scoped program, and the required green gate for waves 1 and 2 cannot be reached.

The derived config must explicitly replace the inherited include set, for example with an empty `include`, and its effective file list should be checked with `tsc --showConfig` before the plan relies on it.

## 2. The controller tests still do not prove that every menu setting is usable

- **Plan section:** C4; `03-settings-menu`, controller-layer verification
- **Severity:** BLOCKING
- **Concrete failure scenario:** The required controller cases exercise Escape, Save, model search, and model selection, but never drive the Recap Thinking Level selector, Auto Recap selector, any of the three preset screens, or the Custom input's valid, invalid, and cancelled paths. A row-index or key-routing error can make Maximum Words edit Idle Delay, make Custom impossible to submit, or show unsupported thinking levels, while every listed reducer and controller assertion passes. This fails both AC-1 and the spec's explicit verification of model-supported thinking lists and staged edits.

The controller matrix must traverse all seven main rows, assert the configured-model and null-model thinking choices, and exercise preset plus Custom behavior for each numeric field. Search assertions must also use separate id, provider, and model-name queries, because one generic narrowing case does not prove all three required match fields.

## 3. Successful menu Save is not connected to runtime behavior by any assertion

- **Plan section:** C4 Save flow; `03-settings-menu`; `04-index-rewrite`
- **Severity:** BLOCKING
- **Concrete failure scenario:** The controller test requires a valid Save to persist once and close, but does not require `onSaved(config)` to run with the saved config. The index harness tests timer changes through typed commands, not through `/recap settings`. An implementation can write the new Auto Recap and Idle Delay values, close the menu, leave the cached timer state unchanged, and pass every named test, even though the spec requires Save to apply timer changes before closing.

Add an order-sensitive controller or integration assertion covering `saveConfig` then `onSaved` then close, including disabling Auto Recap and changing Idle Delay through the menu.

## 4. The index harness covers only part of the canonical command surface

- **Plan section:** `04-index-rewrite`, test-index requirements; AC-1, AC-12, AC-14 coverage claims
- **Severity:** BLOCKING
- **Concrete failure scenario:** `test-index` exercises bare refresh, auto, delay, model, and thinking, but not `settings`, `config`, `messages`, `words`, or the `usage` and `unknown` dispatch results. Parser tests cannot prove switch wiring. The real command handler can parse `/recap words 150` correctly and then omit or misroute that branch, or try to open the TUI in non-TUI mode, while all named tests remain green.

The real-extension harness must invoke every canonical command result, including the non-TUI settings notice and immediate persistence of Recent Messages and Maximum Words, and must assert that usage and legacy-hint messages reach the UI without triggering generation.

## 5. AC-16 remains only partially verified

- **Plan section:** AC-16; `04-index-rewrite`, test-index requirements
- **Severity:** RISKY
- **Concrete failure scenario:** The harness checks timer clearing and rescheduling when settings change, but not the defining inactivity behavior: `input` and `turn_start` must reset the timer and Auto Recap must not start before a full uninterrupted Idle Delay. It also tests only a null-model startup skip, so resume/fork generation can be absent for configured models and still pass, and it omits the manual empty-conversation feedback path. Widget rendering is asserted without requiring the above-editor placement.

These are reachable state transitions named directly in AC-16, so the minimum harness list should include them rather than leaving them to the general instruction to preserve existing behavior.

## 6. The scoped gate creates a new parallel merge seam

- **Plan section:** Waves; `02-generate`; `03-settings-menu`; `tsconfig.modules.json`
- **Severity:** RISKY
- **Concrete failure scenario:** Tasks 02 and 03 branch in parallel and are both instructed to edit the same `files` array in `tsconfig.modules.json`. Their otherwise independent changes now conflict at merge, and accepting either side loses the other module from the post-merge scoped gate. This adds coordinator resolution exactly at the synchronization point intended to verify both branches.

Task 01 should own a pattern-based scoped config that automatically includes whichever target modules exist, or the parallel tasks should use separate scoped configs with a coordinator-owned combined gate.

## 7. The completion-path identity assertion is not tied to the function default

- **Plan section:** C3; `02-generate`, test-gates verification
- **Severity:** RISKY
- **Concrete failure scenario:** C3 exposes `generateRecapText` but no named production dependency binding. Comparing an exported reference with `completeSimple` can prove that the reference is correct without proving that an un-injected `generateRecapText` actually uses it. The function can still default to the old `complete` path while the proposed reference-equality assertion passes.

The contract must make the default dependency binding observable, or the test must call the no-injection path under a controlled module spy and assert that the compatibility export receives the request.

## Verdict

**revise**

The overall decomposition can remain, including the merged first task and single index task. Before dispatch, fix the effective TypeScript input set and make the menu and index harnesses cover the complete behavioral surfaces they claim to own.
