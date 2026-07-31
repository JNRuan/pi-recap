# pi-recap

A pi extension that displays a running, task-oriented recap of the recent conversation above the editor.

## Tech stack

- **Runtime**: jiti (pi loads TS directly) / pnpm (scripts and dependencies)
- **Language**: TypeScript 6, strict, ES2022, bundler module resolution
- **Testing**: Vitest
- **Pi packages**: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`

## Code organization

```
src/index.ts                   Extension entry: lifecycle, widget, /recap dispatch, timer
src/index.test.ts              Entry lifecycle and notification behavior
src/recap/commands.ts          Canonical /recap subcommand parsing
src/recap/conversation.ts      Recent visible message and compaction-summary extraction
src/recap/generate.ts          Generation gates, prompt, completion, output trimming
src/settings/config.ts         Global settings validation, migration, and persistence
src/settings/menu.ts           Staged TUI settings menu and draft reducers
src/testing/support.ts         Shared test models and registry fakes
src/{recap,settings}/*.test.ts Colocated Vitest behavior suites
```

## Conventions

- Zero `any` types. Narrow via type assertions (`as Model<Api>`) when pi types are broad.
- ESLint `strictTypeChecked` + `stylisticTypeChecked` + prettier.
- `eslint-disable` only for demonstrable false positives (e.g. event-driven state across `await`).
- Husky pre-commit runs prettier + eslint on staged `.ts` files.

## Commands

```bash
pnpm check        # tsc --noEmit
pnpm test         # Vitest suites
pnpm test:watch   # Vitest watch mode
pnpm lint         # eslint src/
pnpm format       # prettier --write .
pnpm format:check # prettier --check .
```

Run one suite directly:

```bash
pnpm test src/recap/conversation.test.ts
```
