# Scout report: discovery (tooling, conventions, environment)

## Tooling (pnpm for deps/checks, bun for scripts)

- `pnpm check` → `tsc --noEmit` (package.json:19-25)
- `pnpm lint` → `eslint src/`
- `pnpm format` → `prettier --write .`
- `pnpm format:check` → `prettier --check .`
- No `build` or `test` script exists. Testing = `bun run scripts/test-extract.ts` (AGENTS.md:29-33).
- `prepare` → `husky || true`

## Conventions (AGENTS.md)

- TS strict, ES2022, bundler resolution (tsconfig.json:2-9). Zero `any`; narrow via assertions (`as Model<Api>`).
- ESLint strictTypeChecked + stylisticTypeChecked + prettier (eslint.config.mjs:1-24); `no-non-null-assertion: off`, `restrict-template-expressions` allows numbers.
- Code map: index.ts (entry/lifecycle/widget/command/idle timer), conversation.ts (extraction), config.ts (settings/validation/defaults/args), scripts/test-extract.ts (smoke tests).

## Pre-commit

- `.husky/pre-commit` → `pnpm exec lint-staged`
- lint-staged (package.json:26-32): `*.ts` → prettier --write, eslint --fix; `*.{mjs,json,md}` → prettier --write.

## Commit convention

Conventional Commits (`fix:`, `feat:`, `chore:`, `docs:`, optional scope e.g. `fix(recap):`). Last ~10 commits consistently typed.

## Environment

- No `.env` needed (nothing in src/ suggests one). UNCONFIRMED necessity.
- Shell wraps npm/pnpm/bun/yarn through safe-chain (`wrapSafeChainCommand`); may hide young packages during install.
- `.prettierrc`: semi, doubleQuote, no trailing comma, printWidth 100, tabWidth 2.
- `.gitignore` excludes `docs/agents`; the whole `docs/` tree plus `CONTEXT.md` is currently untracked (git status `?? CONTEXT.md`, `?? docs/`).

## Packages

- Registry: 0.80.10 is the latest published version of all three `@earendil-works/{pi-ai,pi-coding-agent,pi-tui}` (lockstep versioning).
- Installed: peerDependencies `"*"` (package.json:12-16); pnpm-lock.yaml:11-20 resolves 0.74.0; node_modules symlinks confirm 0.74.0.
