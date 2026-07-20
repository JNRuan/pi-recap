# Task 02: generate report

## Result

Implemented C3 without deviation. The new generation module owns the version-sensitive Pi AI imports, builds the revised prompt verbatim, normalizes and trims recap output, runs the shared preflight gates, and calls the 0.80.10 compatibility completion path through an injectable dependency.

## Commit

- `fbc063cf97e17434e3d846f9cf3b0c0a8fb71482 feat: add recap generation module`

## Files changed

- `src/generate.ts`
- `scripts/test-trim.ts`
- `scripts/test-prompt.ts`
- `scripts/test-gates.ts`

No out-of-scope file was modified. In particular, `src/index.ts`, `src/conversation.ts`, `src/settings-menu.ts`, `tsconfig.modules.json`, `package.json`, and documentation were untouched.

## Implementation notes

- `buildRecapSystemPrompt()` emits the specification text exactly with the configured word limit interpolated.
- `enforceWordLimit()` uses the pinned sentence-terminator run and closing quote/bracket heuristic, preserves text already within the limit, and attaches U+2026 directly to retained text.
- `preflightRecap()` awaits `registry.refresh()` before `find()`, implements the null-model trigger matrix, warns for missing models and failed authentication on every non-null trigger, and makes generation-time clamps self-quiescing.
- A clamp save failure emits an error but returns a successful preflight result with the effective level, and the test invokes generation afterward.
- `defaultCompletion` is the real `completeSimple` import by identity. `generateRecapText()` passes one user message plus `systemPrompt`, forwards `apiKey`, `headers`, and `env`, and omits `reasoning` for `off`.

## Assumptions resolved

- The 0.80.10 `completeSimple()` context accepts `systemPrompt` and a `messages` array. The user message shape is `{ role: "user", content: [{ type: "text", text }], timestamp }`.
- A non-generic structural completion type over `Model<Api>`, `Context`, `SimpleStreamOptions`, and `AssistantMessage` accepts the real generic `completeSimple` function while remaining straightforward to fake.
- Successful authentication does not require `apiKey` to be present because provider environment or other resolved authentication may be sufficient. All successful auth fields are forwarded unchanged.

## Verification

Passed:

- `bun run ./scripts/test-baseline.ts`
- `bun run ./scripts/test-config.ts`
- `bun run ./scripts/test-commands.ts`
- `bun run ./scripts/test-extract.ts`
- `bun run ./scripts/test-trim.ts`
- `bun run ./scripts/test-prompt.ts`
- `bun run ./scripts/test-gates.ts`
- `pnpm exec tsc --noEmit -p tsconfig.modules.json`
- `pnpm exec eslint src/generate.ts`
- `pnpm exec eslint src/generate.ts scripts/test-trim.ts scripts/test-prompt.ts scripts/test-gates.ts`
- `pnpm format:check`
- `git diff --check`
- Husky lint-staged hook on commit, including Prettier and ESLint for all four staged TypeScript files
- Post-commit scoped typecheck, source lint, and all three new test scripts

Expected failures, confined to task 04 scope:

- `pnpm check` exits 2 only for the untouched legacy `src/index.ts`, which still imports removed config exports and the old Pi AI `complete` export.
- `pnpm lint` exits 1 with 69 errors only in the untouched legacy `src/index.ts`, cascading from the same unresolved old API surface.

The pnpm commands also printed a non-fatal warning that `/Users/stacktrace/.npmrc` could not be read with `EPERM`; it did not affect command results.

## Incomplete or concerning

Nothing incomplete within C3. Integration into lifecycle and command wiring remains intentionally deferred to task 04. Manual or visual verification was not required.
