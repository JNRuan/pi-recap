# pi-recap

A pi extension that displays a running recap of the conversation above the editor.

## Tech stack

- **Runtime**: bun (scripts) / pnpm (deps) / jiti (pi loads TS directly)
- **Language**: TypeScript 6, strict, ES2022, bundler module resolution
- **Pi packages**: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`

## Code organization

```
src/index.ts          Extension entry — lifecycle, widget, /recap command, timer
src/conversation.ts   Plain-text extraction with recency bias and compaction handling
src/config.ts         Settings validation, CLI flags, arg parsing, config resolution
scripts/test-extract.ts Smoke tests for conversation extraction
```

## Conventions

- Zero `any` types. Narrow via type assertions (`as Model<Api>`) when pi types are broad.
- ESLint `strictTypeChecked` + `stylisticTypeChecked` + prettier.
- `eslint-disable` only for demonstrable false positives (e.g. event-driven state across `await`).
- Husky pre-commit runs prettier + eslint on staged `.ts` files.

## Commands

```bash
pnpm check        # tsc --noEmit
pnpm lint         # eslint src/
pnpm format       # prettier --write .
pnpm format:check # prettier --check .
```

Run smoke tests:

```bash
bun run scripts/test-extract.ts
```
