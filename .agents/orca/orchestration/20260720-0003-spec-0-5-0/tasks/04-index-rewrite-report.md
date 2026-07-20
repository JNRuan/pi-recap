# Task 04: index rewrite report

## Result

Rewrote `src/index.ts` to wire the completed config, command, generation, and settings-menu modules into one extension lifecycle. The implementation adds the load-safe Pi version guard, C7 typed-thinking behavior, all C8 injection seams, shared generation for manual, Auto Recap, startup, and compaction triggers, normalized typed setters, and the staged settings-menu dispatch. Added the behavioral `scripts/test-index.ts` harness and removed `tsconfig.modules.json` after proving that the root TypeScript program covers every script.

## Commit

- `8ff19396554360308c397bf433c0497886f60e43` `feat: wire recap lifecycle and commands`

## Files changed

- `src/index.ts`: lifecycle registration, version guard, dynamic module boundary, recap generation sequence, timer caching, command dispatch, settings-menu wiring, and C8 seams.
- `scripts/test-index.ts`: fake Pi, context, registry, settings, completion, widget, and timer harness covering the pinned index behavior.
- `tsconfig.modules.json`: deleted after the root typecheck became green and its effective file list was confirmed to include all source and script files.

No out-of-scope source module was modified. In particular, `src/config.ts`, `src/commands.ts`, `src/conversation.ts`, `src/generate.ts`, and `src/settings-menu.ts` were consumed as merged.

## Behavior delivered

- Pi versions below 0.80.10 register only the friendly `session_start` error handler. The generation and settings modules are not loaded on that path.
- All four triggers use the same preflight and generation path. Only Auto Recap uses leaf deduplication, and only Auto Recap respects the enabled toggle.
- Failed gates and empty conversations occur before the spinner. They leave the previous recap and recapped leaf unchanged.
- Successful output is normalized and sentence-trimmed to Maximum Words before the widget is updated. Empty output warns and restores the previous recap.
- The runtime caches Auto Recap and Idle Delay independently. Activity clears the timer, and a new timer begins only after the appropriate idle transition.
- `/recap` dispatches the canonical grammar, including the non-TUI settings notice, effective config output, immediate normalized setters, model-aware clamping, C7 persistence for unavailable models, migration warnings, and manual refresh while Auto Recap is disabled.
- The menu receives real load, save, registry, and `onSaved` dependencies. Its saved config updates both timer caches and reschedules or clears the timer.

## C8 harness coverage

`scripts/test-index.ts` registers the real entry point with injected version, dynamic loader, temp-directory settings source and agent directory, fake timers, and fake completion. It asserts:

- null-model manual warning and silent Auto Recap, startup, and compaction skips with no model or widget call;
- failed-gate preservation of recap text, leaf ID, and widget state;
- Auto Recap-only leaf deduplication and manual refresh while disabled;
- Auto Recap off/on and Idle Delay timer/cache persistence;
- interrupted inactivity through `input` and `turn_start`, followed by a full uninterrupted Idle Delay;
- resolvable thinking clamp, exact C7 unavailable-model warning and persistence, model-change clamp, unavailable model persistence, model clearing, and generic thinking storage;
- settings, config, messages, words, every missing-value usage result, garbage, and all four legacy command hints without generation;
- resume, fork, and compaction generation through the shared path;
- pre-spinner empty-conversation feedback, successful widget rendering, empty-response preservation, and normalized sentence-aware trimming;
- old-version registration with one handler and zero dynamic-loader calls.

**C8 weakened or dropped assertions: NONE.** Every assertion required by the assignment is present without weakening.

## Named inspections

**AC-14 zero `registerFlag` calls: PASS.** `rg -n 'registerFlag\(' src` returned no matches. The four legacy flag registrations and override plumbing are absent.

**C6 static-import allowlist: PASS.** Actual runtime static imports in `src/index.ts` are `SettingsManager` and `VERSION` from `@earendil-works/pi-coding-agent`, `Text` from `@earendil-works/pi-tui`, and `./commands.js`, `./config.js`, and `./conversation.js`. Static imports from `@earendil-works/pi-ai`, `./generate.js`, and `./settings-menu.js` are type-only and erased. Runtime Pi AI, generation, and settings-menu values load through `defaultModuleLoader()` only after the version check at `src/index.ts:238`; the injected old-version test observes zero loader calls.

**AC-4 no writes to Pi model/thinking settings: PASS.** `rg` found no `setModel`, `setThinkingLevel`, `ModelSelectorComponent`, or default-model writes in `src/index.ts` or `src/settings-menu.ts`. Typed setters and menu Save write only the extension's normalized `piRecap` config through `saveRecapConfig`.

**AC-16 widget-above-editor placement: PASS.** The widget remains registered with `{ placement: "aboveEditor" }` at `src/index.ts:182`, and the harness asserts the placement on successful generation.

## Verification

Passed with observed exit code 0:

- `pnpm check`
- `pnpm lint`
- `bun run ./scripts/test-baseline.ts`
- `bun run ./scripts/test-config.ts`
- `bun run ./scripts/test-commands.ts`
- `bun run ./scripts/test-extract.ts`
- `bun run ./scripts/test-trim.ts`
- `bun run ./scripts/test-prompt.ts`
- `bun run ./scripts/test-gates.ts`
- `bun run ./scripts/test-menu.ts`
- `bun run ./scripts/test-index.ts`
- `pnpm format:check`
- `pnpm exec eslint src/index.ts scripts/test-index.ts`
- `git diff --cached --check`
- default dynamic-loader Bun smoke, which registered the extension without injected modules and completed the real post-guard imports
- Husky lint-staged hook on commit, including Prettier and ESLint for both changed TypeScript files

`pnpm exec tsc --showConfig` listed all six `src/**/*.ts` files and all nine `scripts/**/*.ts` files, including `scripts/test-index.ts`. Root `pnpm check` remained green after `tsconfig.modules.json` was deleted.

The pnpm commands printed the existing non-fatal warning that `/Users/stacktrace/.npmrc` could not be read with `EPERM`; it did not affect any result.

## Manual verification

`pi -p "hi"` was not verified. Running it would read the user's real Pi configuration and could make a paid provider request. The non-TUI command path, old-version guard, settings isolation, real default dynamic imports, and generation wiring were verified through the injected harness instead.

## Assumptions resolved

- The C5 root-tsconfig probe remains true after this task: scripts are part of the root program, so the scoped config has reached end of life.
- The real dynamic import paths resolve under Bun; the default-loader smoke passed.
- The C8 settings seams keep every harness read and write inside a generated temp directory. No harness operation falls back to the real Pi agent directory.

## Incomplete or concerning

No implementation or automated verification item is incomplete. The only unverified item is the explicitly recorded `pi -p "hi"` manual smoke above.
