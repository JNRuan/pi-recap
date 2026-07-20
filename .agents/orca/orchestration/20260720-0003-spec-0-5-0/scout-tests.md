# Scout report: test coverage

## scripts/test-extract.ts

- Imports only `buildRecentConversationText` from src/conversation.ts (scripts/test-extract.ts:1).
- 3 cases (50-turn recency cutoff line 13; compaction entry line 44; oversized message line 87), all ending in `console.log` (lines 38-41, 82-84, 102-105). No assertions.
- Run via `bun run scripts/test-extract.ts`; bun 1.3.13 installed. Not in package.json scripts (no `test` script).

## Other infra

- No .github/, no CI, no vitest/jest. scripts/ has exactly one file.

## Coverage

- conversation.ts `buildRecentConversationText` (:88): exercised unasserted. Helpers `extractTextParts` (:18), `buildConversationSlice` (:47) indirect only.
- config.ts: zero coverage — `validatePiRecapSettings` (:26), `loadSettingsPiRecap` (:62), `parseRecapModel` (:70), `parseRecapIntervalSeconds` (:87), `saveRecapSettings` (:99), `resolveConfig` (:125).
- index.ts: zero coverage.

## Testability seams

- Pure/testable now: config.ts validators/parsers/resolveConfig; conversation.ts builders; `loadSettingsPiRecap(sm)` fakeable via stub.
- Hard: `saveRecapSettings` uses direct fs against `getAgentDir()` (config.ts:99-123); index.ts has no DI — direct `ctx.modelRegistry.*`, `complete()`, `ctx.ui.*` calls (index.ts:169-205); module-scope mutable state (index.ts:246-252, 51-55); raw timers in startSpinner/scheduleIdleRecap.
