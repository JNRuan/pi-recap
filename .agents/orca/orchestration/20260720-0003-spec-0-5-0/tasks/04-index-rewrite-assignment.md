# Assignment: 04-index-rewrite

## Objective & scope

Deliver plan task 04: rewrite `src/index.ts` to wire the finished modules into the extension
lifecycle — load-safe version guard (C6), the four `--recap-*` flags and overrides plumbing
and startup no-model warning deleted, all four triggers through
`preflightRecap`/`generateRecapText`, command dispatch on `parseRecapCommand` (settings opens
the task-03 menu; non-TUI notice), typed setters (including C7), C8 test seams — plus the
behavioral harness `scripts/test-index.ts`. This produces the run's first fully green tree.

Also yours: decide `tsconfig.modules.json`'s end-of-life per the C5 probe (see below).

Out of scope: `src/conversation.ts` (unchanged), `src/config.ts` / `src/commands.ts` /
`src/generate.ts` / `src/settings-menu.ts` (consume them as-is; if a contract cannot work as
pinned, escalate — do not reshape them), README/AGENTS.md, version bump.

## The plan

Full run plan (absolute):
`/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/plan.md`

Read it in full except the coordinator-only "Orchestration" section. **Your task is
"04-index-rewrite"**. Contracts C6 (load safety), C7 (typed thinking with unresolvable
model), and C8 (test-harness seams) are yours to implement — read all three carefully in
plan.md.

Companion sources (same directory): `spec_0_5_0.md` (behavior authority — especially
"Commands", "Generation gates", "Existing behavior retained"), `source-plan_0_5_0.md` (design
authority — your task implements its **M3** section, plus the "runRecap call sequence" from
M2; also read "Decisions already made"), `CONTEXT.md` (domain language; user-facing text:
"Recap Model", "Recap Thinking Level", "Auto Recap", "Idle Delay"; never "effort"/"interval").

Also read `AGENTS.md` in your worktree.

## Inputs from completed tasks

All merged into your branch already:

- Task 01: `src/config.ts` (C1), `src/commands.ts` (C2), `tsconfig.modules.json`, C5 notes at
  `/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/tasks/01-baseline-api-notes.md`
  (READ IT — verified 0.80.10 surface). **C5 probe results**: root tsconfig's include covers
  `scripts/` (so you MAY delete `tsconfig.modules.json` once repo-wide `pnpm check` is
  green); pi-tui components are headlessly constructible.
- Task 02: `src/generate.ts` (C3): `preflightRecap(config, trigger, deps)` (registry.refresh
  is async — await), `generateRecapText`, `defaultCompletion`, `buildRecapSystemPrompt`,
  `normalizeRecapText`, `enforceWordLimit`, `RecapTrigger`. Its report notes: completion
  context shape `{systemPrompt, messages: [{role: "user", content: [{type: "text", text}],
timestamp}]}`; auth success may omit apiKey (env-based providers) — forward all fields.
- Task 03: `src/settings-menu.ts` (C4): `openRecapSettingsMenu(deps)` with
  `deps: {ui, registry, loadConfig, saveConfig, onSaved}`; Save order saveConfig → onSaved →
  close; plus exported reducers and a headless controller (see its report for the exported
  surface). Its report notes: raw key events are terminal strings (`\r`, `\x1b`, `\x1b[B`).
- Bun quirk: invoke scripts as `bun run ./scripts/<file>.ts` (with `./`).

## Binding behavior (from plan + source-plan M3, plus pinned contracts)

- **Version guard (C6)**: static imports in index.ts restricted to pi-coding-agent root
  exports existing at 0.74.0 (`VERSION`, `getAgentDir`, types), pi-tui root exports existing
  at 0.74.0 (widget needs), `./config.js`, `./commands.js`, `./conversation.js`
  (conversation.ts has no Pi imports). `./generate.js` and `./settings-menu.js` load via
  dynamic `import()` only after `isVersionAtLeast(VERSION, REQUIRED_PI_VERSION)` passes.
  Guard failure: register only a `session_start` handler notifying
  `"pi-recap requires Pi >= 0.80.10 (found <VERSION>); recap is disabled."` as error; skip
  all other registration. Type-only imports are exempt.
- **Deletions**: all four `pi.registerFlag("recap-*")` calls; the overrides plumbing; the
  `RECAP_MODEL_UNSET_WARNING` session_start warning (null model at startup is silent).
- **Timer**: rename cache to `currentIdleDelaySeconds`; cache `autoRecapEnabled` alongside at
  session_start; `scheduleIdleRecap` only when enabled and delay > 0; setters and menu Save
  (via `onSaved`) update both caches and reschedule/clear.
- **Triggers**: resume/fork → `runRecap(ctx, "startup")` unconditionally (preflight handles
  null silently); `session_compact` → `"compaction"`; idle tick → `"auto"`; bare `/recap` →
  `"manual"` (ignores the Auto Recap toggle and Idle Delay).
- **runRecap sequence** (source-plan M2): (1) alive/pending checks; leaf-dedup applies to
  `auto` only; (2) load config; (3) `auto` only: `autoRecapEnabled === false` → silent
  return; (4) `preflightRecap` — on `{ok: false}`: no widget change, previous recap and
  `lastRecapEntryId` untouched; (5) build conversation text; empty → `manual` gets info
  "Recap: nothing to recap yet", others silent; still no widget; (6) only now render the
  loading spinner; (7) generate, existing generation/leaf/alive post-checks,
  `normalizeRecapText`, empty-response warning (previous recap kept), `enforceWordLimit`,
  store `lastRecapText`/`lastRecapEntryId`, final render. Preserve the existing widget
  rendering (above the editor) and spinner behavior.
- **Command dispatch** on `parseRecapCommand(args)`:
  - `refresh`: clear timer, manual recap, reschedule as today.
  - `settings`: `!ctx.hasUI` → notify "Recap: interactive settings require TUI mode. Typed
    /recap subcommands remain available."; else open the task-03 menu with real deps
    (`onSaved` updates caches + timer).
  - `config`: notify effective config, e.g.
    `Recap: model=<provider/id|(none)> thinking=<level> auto=<on|off> idleDelay=<n>s recentMessages=<n> maxWords=<n>`.
  - `auto`: persist; `on` reschedules if idle, `off` clears; Idle Delay untouched.
  - `model`: await refresh, find. Found → clamp stored thinking via `clampThinkingLevel`,
    persist model + clamped level in one save, notify (mention clamp if changed). Not found →
    still persist the ref with a warning (configured-but-missing is representable). `none` →
    persist `recapModel: null`.
  - `thinking`: no model configured → store any valid level. Model configured and resolvable
    → clamp, persist effective, notify effective. Model configured but NOT resolvable → **C7**:
    persist the valid level as-is and warn
    `Recap: <provider>/<id> is not currently available; Recap Thinking Level <level> will be clamped when the model is available.`
  - `delay`/`messages`/`words`: persist; `delay` updates cached delay and reschedules if
    enabled and idle (enabled flag untouched).
  - `usage`/`unknown`: notify as warning; NO generation.
  - Every setter persists via the one normalized writer (full config write).
- **C8 seams** (pinned; their absence is a contract violation): injectable version string
  (default real `VERSION`); injectable dynamic-import loader (default real `import()`) so the
  harness can observe no-import-on-old-Pi and inject fakes; injectable settings source AND
  agent dir for load/save (harness routes everything to a temp dir — the harness must NEVER
  read or write the real `~/.pi/agent/settings.json`); injectable timer facade (default real
  setTimeout/clearTimeout); completion already injectable via generate's seam. Design the
  registration entry so `scripts/test-index.ts` can construct the extension with a fake `pi`
  registration surface and fake `ctx` and drive every handler.
- Update the registered `/recap` command description to the new subcommand list.

## Verification requirements

1. Whole repo, first green tree: `pnpm check` && `pnpm lint` && every bun script
   (`./scripts/test-baseline.ts`, `test-config`, `test-commands`, `test-extract`,
   `test-trim`, `test-prompt`, `test-gates`, `test-menu`, and your new `test-index`) &&
   `pnpm format:check`.
2. `scripts/test-index.ts` — fake-context harness on the C8 seams (fake pi registration
   surface, ctx.ui recorder, fake registry/auth, fake session entries, injected fake
   completion, temp-dir settings, fake timers), registering the real extension, asserting at
   minimum:
   - null-model manual `/recap` warns, no widget change, no completion call; auto/startup/
     compaction skip silently;
   - failed gate leaves previous recap text and `lastRecapEntryId` untouched;
   - dedup suppresses only `auto` re-runs at the same leaf; bare `/recap` refreshes with
     `autoRecapEnabled: false`;
   - `/recap auto off` clears the idle timer and preserves the delay; `auto on` reschedules;
     `/recap delay` updates cached delay without touching the enabled flag;
   - inactivity semantics: `input`/`turn_start` activity resets the idle timer; auto recap
     does not fire before one full uninterrupted Idle Delay (fake timers);
   - `thinking` setter: clamps + persists effective level against a resolvable model; C7 path
     with an unresolvable configured model (persist + warning);
   - `/recap model` persists an unresolvable ref with a warning;
   - every remaining canonical command: `settings` in non-TUI mode notifies the TUI-required
     message (no menu, no generation); `config` reports effective config; `messages` and
     `words` persist immediately; `usage` results and `unknown` results (garbage plus each
     legacy head with its hint) reach the UI as warnings with NO generation;
   - `session_compact` routes through the shared path; resume/fork startup with a configured,
     available model generates (fake completion called);
   - manual `/recap` on an empty conversation notifies "nothing to recap" pre-spinner;
   - successful generation renders the widget; empty response warns and keeps previous
     recap; an oversized fake completion result is normalized and trimmed per the configured
     word limit in the rendered widget;
   - version-guard path: injected old version → only the friendly session_start error
     registers, and the injectable loader observes no dynamic module import.
     If any listed assertion must be weakened or dropped despite the seams, NAME it in your
     report (C8 rule).
3. `tsconfig.modules.json`: the C5 probe confirmed root `pnpm check` covers `scripts/` — so
   delete it once repo-wide `pnpm check` is green, and confirm scripts are still typechecked
   afterwards (`pnpm check` must fail if a script has a type error — verify via
   `tsc --showConfig` listing).
4. Manual: `pi -p "hi"` non-TUI smoke only if feasible in this worktree — otherwise record
   "not verified" explicitly.
5. Your report MUST contain named inspection lines for: zero `registerFlag` calls (AC-14);
   the C6 static-import allowlist (list index.ts's actual static imports); no writes to Pi's
   model/thinking settings (AC-4); widget-above-editor placement preserved (AC-16).

## Project tooling

Install: pnpm install --safe-chain-skip-minimum-package-age (only if node_modules missing)
Build: none
Test: bun run ./scripts/<script>.ts (note the ./ prefix)
Lint: pnpm lint (must be fully green when you finish)
Typecheck: pnpm check (must be fully green when you finish)
Format check: pnpm format:check
Format write: pnpm format
Commit style: Conventional Commits (feat:, fix:, chore:, docs:, optional scope). Husky pre-commit runs lint-staged.

## Worktree & branch

Worktree (absolute): /Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0-04-index-rewrite
Branch: 20260720-0003-spec-0-5-0-04-index-rewrite

All work happens in this worktree. Anchor every shell command to the absolute worktree path.

## Reporting

Commit all work in the commit style above. Write your full report to:

/Users/stacktrace/orca/workspaces/pi-recap/20260720-0003-spec-0-5-0/.agents/orca/orchestration/20260720-0003-spec-0-5-0/tasks/04-index-rewrite-report.md (absolute path)

Include: commits, files changed, checks run with actual results, the four named inspection
lines, any weakened/dropped test-index assertion (named), assumptions resolved, anything
incomplete or concerning. Report what actually happened. That report file is the only file
you may write outside your worktree. Then report completion. If blocked, escalate instead of
improvising.
