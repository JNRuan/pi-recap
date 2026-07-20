# Task 01 report: baseline, config, and commands

## Outcome

Task 01 is complete in commit `1432b80443fe18662afd58cc3aa73da2ceb05226` (`feat: add baseline config and command modules`). The worktree is clean. `src/index.ts` and `src/conversation.ts` were not modified.

The three Pi peer ranges and installed packages are at the required 0.80.10 baseline. C1 and C2 are implemented with assertion-based tests, the C5 notes were written before feature code, and the scoped typecheck and targeted lint gates are green.

## Files changed

- `package.json`: all three Pi peer ranges are `>=0.80.10`.
- `pnpm-lock.yaml`: all three Pi packages resolve to 0.80.10, with the corresponding transitive graph update.
- `src/config.ts`: C1 types, defaults, version comparison, independent field validation and migration, global-only loading, six-key normalization, and atomic full-object save.
- `src/commands.ts`: C2 pure command grammar, first-slash model parsing, positive safe-integer parsing, canonical usage results, and legacy migration hints.
- `scripts/test-baseline.ts`: peer ranges, all three installed package versions, coding-agent `VERSION`, version matrix, prereleases, and unequal segment counts.
- `scripts/test-config.ts`: all thinking levels, ignored `effort`, all migration tables, partial migration, normalized writes, global-only reads, and temp-directory save round-trip.
- `scripts/test-commands.ts`: all canonical forms, usage paths, first-slash model IDs, `none`, legacy hints, refresh-only empty input, unknown input, whitespace, and unsafe integers.
- `tsconfig.modules.json`: explicit scoped include and exclude globs.
- External allowed artifact: `tasks/01-baseline-api-notes.md`.
- This report: `tasks/01-baseline-config-commands-report.md`.

## Baseline installation

The first required `pnpm up` found the existing `node_modules` linked to `/Users/stacktrace/Library/pnpm/store/v10` while the Orca workspace selected its local `.pnpm-store/v10`; pnpm refused the mixed-store update. `pnpm install --config.confirmModulesPurge=false` recreated the generated dependency directory against the workspace store and installed all three packages at 0.80.10. Re-running the required `pnpm up "@earendil-works/pi-ai@0.80.10" "@earendil-works/pi-coding-agent@0.80.10" "@earendil-works/pi-tui@0.80.10"` succeeded with `Already up to date`.

The safe-chain minimum-age rule did not hide 0.80.10, so its bypass flag was not needed. Pnpm consistently printed a non-fatal `EPERM` warning for `/Users/stacktrace/.npmrc`; `nono why` identified the sandbox credential-protection rule. No attempt was made to expose or bypass that protected file, and the public package install and all pnpm checks completed without it.

## C5 API verification

Full evidence is in `tasks/01-baseline-api-notes.md`. Confirmed items include:

- `completeSimple` from `@earendil-works/pi-ai/compat`.
- `ThinkingLevel` includes `max`; `ModelThinkingLevel` adds `off`.
- `SimpleStreamOptions.reasoning?: ThinkingLevel`.
- Root `getSupportedThinkingLevels` and `clampThinkingLevel` exports.
- Auth success includes optional `apiKey`, `headers`, and `env`.
- `ctx.ui.custom`, `select`, `confirm`, `input`, `notify`, `setWidget`, and `ctx.hasUI`.
- `SelectList`, `Input`, `Container`, `Text`, `getSelectListTheme`, and `VERSION` signatures and exports.
- `SelectList` has no public in-place item replacement method, so later menu work must rebuild changed lists.

### C5 DIFFERS

- `ModelRegistry.refresh()` is `Promise<void>`, not the synchronous `void` pinned in the original C3/C4 structural contracts. This was escalated as `msg_37d99167df7b`. The coordinator acknowledged it and will re-pin C3/C4 so all refresh call sites await completion before registry reads. C1 and C2 are unaffected.

### C5 probes

- Headless TUI probe: PASS. Under Bun with no TTY, `SelectList` and `Input` constructed and rendered; selection, filtering, text input, submit, and Escape handlers all passed assertions.
- Root config probe: PASS. `pnpm exec tsc --showConfig` reported `include: ["src/**/*.ts", "scripts/**/*.ts"]` and effective files `src/config.ts`, `src/conversation.ts`, `src/index.ts`, and `scripts/test-extract.ts`. Root typechecking covers scripts.

## Verification results

Green post-commit gates:

- `bun run ./scripts/test-baseline.ts`: PASS.
- `bun run ./scripts/test-config.ts`: PASS.
- `bun run ./scripts/test-commands.ts`: PASS.
- `bun run ./scripts/test-extract.ts`: PASS. Output was redirected because the existing smoke script prints a 30,000-character fixture.
- `pnpm exec tsc --noEmit -p tsconfig.modules.json`: PASS.
- `pnpm exec eslint src/config.ts src/commands.ts`: PASS.
- `pnpm exec eslint scripts/test-baseline.ts scripts/test-config.ts scripts/test-commands.ts`: PASS.
- `pnpm format:check`: PASS.
- `git diff --check`: PASS.
- Husky/lint-staged on commit: PASS, including Prettier and ESLint fix passes for every staged TypeScript file.

`pnpm exec tsc --showConfig -p tsconfig.modules.json` reported this exact effective file list:

```text
./scripts/test-baseline.ts
./scripts/test-commands.ts
./scripts/test-config.ts
./scripts/test-extract.ts
./src/commands.ts
./src/config.ts
```

Its effective inputs are `include: ["scripts/**/*.ts", "src/**/*.ts"]` and `exclude: ["src/index.ts", "src/conversation.ts"]`, as required.

## Expected red repository-wide state

- `pnpm check`: RED, exit 2, with errors only in untouched `src/index.ts`. Exact categories are: removed pi-ai root export `complete` at line 1; removed legacy config exports at lines 8 through 13; old `provider`, `model`, `effort`, and `intervalSeconds` field reads at lines 131, 169, 172, 203, 332, and 414 through 418; and two cascading implicit-any callback parameters at lines 213 and 214. No other source or script appears in the error output.
- `pnpm lint`: RED, exit 1, with 69 type-aware errors only in untouched `src/index.ts`. They cascade from the same deliberately removed imports and fields plus the removed root `complete` API. The task's required targeted lint is green.

No legacy exports or shims were added to hide this intermediate state. Task 04 owns the index rewrite.

## Assumptions resolved

- All three 0.80.10 packages are published and installable through the current wrapper: confirmed.
- All three installed package versions, read from each package's own `package.json`, equal 0.80.10: confirmed by `test-baseline`.
- Safe-chain minimum package age blocks the baseline: false in this run.
- Root TypeScript input covers scripts: true.
- TUI components are headlessly constructible and drivable: true.
- Explicit `recapModel: null` can be distinguished from absence with `Object.hasOwn`: implemented and asserted.
- Project-local settings can be excluded through the narrow global settings source: implemented and asserted without calling the fake project getter.

## Incomplete or concerning

No task-scope implementation remains.

Two environment or downstream concerns remain visible:

1. Bun 1.3.13 fails before file loading for the bare form `bun run scripts/<file>.ts` with `CouldntReadCurrentDirectory`, even though the worktree exists and `bun -e` reads the same `process.cwd()`. The equivalent explicit relative form `bun run ./scripts/<file>.ts` passes for every suite, and direct `bun scripts/test-baseline.ts` also passes. No out-of-scope package-script workaround was added.
2. Later tasks must use the coordinator's re-pinned asynchronous registry refresh contract described above.

There was no manual or visual verification requirement for this task.
