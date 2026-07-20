# Code review — pi-recap 0.5.0 (round 1)

Branch `20260720-0003-spec-0-5-0` vs base `d1e9d8c3e0934cd8d48a35ce338259347bc4ef45`.
Intent source: `docs/specs/spec_0_5_0.md`. Conventions: `AGENTS.md`, `CONTEXT.md`.

Review process: scout pass (blast radius, patterns/library APIs, test coverage), six parallel category reviews (Requirements, Correctness, Security, Reliability, Patterns, Tests), then verification and consolidation against the source, the installed 0.80.10 pi packages, and the base ref. Assumes `pnpm check`, lint, format:check, and all nine Bun suites pass (independently confirmed by the blast-radius scout).

Verified clean: no dangling references to removed symbols; default export satisfies pi's `ExtensionFactory`; jiti resolves the `./generate.js`-style dynamic imports to `.ts` in both dev and Bun-binary modes; `@earendil-works/pi-ai/compat` is available in both modes; `completeSimple`/`SimpleStreamOptions`/`ResolvedRequestAuth` usage matches the installed 0.80.10 typings; pnpm-lock churn is only the three pi peers moving to 0.80.10, no new runtime dependencies; credentials never reach notifications, the widget, or persisted settings; prototype-pollution-safe settings parsing; spec migration rules (Auto Recap, Recap Model), command rules, menu row order, staging/Escape/Save semantics, prompt contract, and word-limit enforcement all trace to matching code.

**Tests review** — see findings above (Issues 7, 8, 10).

## Code Issues

**Issue 1** - Unhandled promise rejections can take down the host Pi process
**Severity**: Medium
**Confidence**: 85/100
**Category:** Bug
**File:** `src/index.ts:248`, `src/index.ts:280-288`
**Findings:**

- `const modules = Promise.resolve((dependencies.moduleLoader ?? defaultModuleLoader)())` eagerly starts the three dynamic imports at registration and stores the promise with no rejection handler. The first handler attaches only at the first `await modules` (`src/index.ts:303`), which may be minutes away or never (Auto Recap disabled, no manual `/recap`). If any import rejects (broken or partial install, filesystem error, future host packaging drift), the rejection is unhandled and Node's default `--unhandled-rejections=throw` terminates the whole Pi process instead of recap failing in isolation.
- `trackBackgroundTask` does `void task.finally(() => backgroundTasks.delete(task))` with no `.catch` on any branch of the chain. The tracked work is mostly self-catching, but several host-API calls sit outside the try blocks: in the idle-tick callback, `ctx.isIdle()`, `widgets.render(...)` and `scheduleIdleRecap` (`src/index.ts:385-390`) run before the `try`, and the `catch`/`finally` clauses themselves call `ctx.ui.notify`/`ctx.isIdle()` (`src/index.ts:396-398`, `423-425`), which can throw during TUI teardown. Any such throw rejects the task with no consumer — same unhandled-rejection outcome. A rejected task also makes the `waitForBackgroundTasks` test seam (`Promise.all`, `src/index.ts:231`) reject while other tasks remain tracked.
  **Evidence:**
- Both Correctness and Reliability reviewers flagged this independently; sites re-read and confirmed (`await modules` consumers at `src/index.ts:303,520,567,599`; no `.catch` anywhere on the `modules` or background-task chains).
  **Fix:**
- Attach a no-op guard at creation: `modules.catch(() => {})` (consumers still observe the rejection at their own `await`), or lazy-initialize the promise on first use.
- In `trackBackgroundTask`: `task.finally(() => backgroundTasks.delete(task)).catch(() => {})`, and move the pre-`try` render/`isIdle` calls inside the existing try/catch.

**Issue 2** - Terminal escape-sequence injection from model output into the TUI widget
**Severity**: Medium
**Confidence**: 85/100
**Category:** Security
**File:** `src/generate.ts:79-104`, `src/index.ts:180`
**Findings:**

- Recap model output is untrusted (derived from conversation content, which can carry prompt injection from files or web pages the agent read), yet it reaches the terminal unsanitized. `normalizeRecapText` only trims and strips a `Recap:` prefix; `enforceWordLimit` splits on `\s+`, so ESC (`\x1b`) and full OSC/CSI sequences survive inside a "word". The widget renders the text via `new Text(theme.fg("dim", `Recap: ${state.text}`), 1, 1)`.
- pi-tui deliberately preserves ANSI: `dist/components/text.js:54` ("this preserves ANSI codes") and `wrapTextWithAnsi` (`dist/utils.js:644`) re-emit escape codes; nothing strips control bytes.
- Concrete trigger: the agent reads an attacker-authored file or page instructing that any summary must begin with specific escape bytes; if the recap model reproduces them, the terminal interprets them on widget render — OSC 52 writes to the clipboard, OSC 0 spoofs the window title, CSI sequences can repaint or visually spoof other TUI regions. Even without a deliberate attack, a stray `\x1b[0m` or embedded newline in model output breaks the dim single-line widget framing.
- The rendering posture is pre-existing (0.4.x rendered model text the same way), but this branch rewrote the whole output pipeline and introduced `normalizeRecapText`/`enforceWordLimit` as the canonical sanitization seam, which currently sanitizes nothing.
  **Evidence:**
- pi-tui source re-read and confirmed (ANSI preserved end to end); `normalizeRecapText`/`enforceWordLimit` confirmed control-char transparent.
  **Fix:**
- In `normalizeRecapText`, map `\n`/`\t` to spaces and strip remaining C0/C1 control characters (at minimum `\x00-\x1f`, `\x7f`, `\x9b`) before trimming; add cases to `scripts/test-trim.ts`.

**Issue 3** - No timeout or cancellation on generation; concurrent triggers silently dropped while a request is in flight
**Severity**: Medium
**Confidence**: 80/100
**Category:** Reliability
**File:** `src/generate.ts:174-192`, `src/index.ts:295`
**Findings:**

- The `completeSimple` call passes only `apiKey`/`headers`/`env`/`reasoning`. `SimpleStreamOptions` supports `signal`, `timeoutMs`, and `maxRetries` (pi-ai `dist/types.d.ts`), and `ctx.signal` exists on `ExtensionContext`; none are wired. SDK-backed providers default to a 10-minute timeout with retries, and providers without SDK defaults can hang indefinitely.
- While `pending` is non-null, every trigger — including manual `/recap` — returns silently at `src/index.ts:295`. A hung request therefore leaves the "generating..." spinner up and all recaps dead for the duration, with zero feedback on manual refresh. `session_shutdown` resets state but never aborts the in-flight request, which keeps consuming network/tokens after the session ends.
- The shape is inherited from 0.4.x, but this branch rewrote the entire generation path and owns it now.
  **Evidence:**
- `src/generate.ts:174` options object confirmed; `src/index.ts:295` early return confirmed; `StreamOptions` fields verified in installed typings.
  **Fix:**
- Pass `timeoutMs` (e.g. 60_000) and modest `maxRetries` in the completion options; consider an AbortController aborted on `input`/`turn_start`/`session_shutdown`.
- On manual `/recap` while pending, notify "Recap: a refresh is already in progress." instead of silently returning.

**Issue 4** - `saveRecapConfig` read-modify-rename races other writers of the global settings file
**Severity**: Medium
**Confidence**: 75/100
**Category:** Reliability
**File:** `src/config.ts:171-192`
**Findings:**

- `saveRecapConfig` reads all of `~/.pi/agent/settings.json`, replaces `piRecap`, writes a fixed `settings.json.tmp`, and renames over the whole file. Pi core writes the same file through `SettingsManager`/`FileSettingsStorage`, which has locking this path bypasses. Any settings change written by Pi core or a second concurrent Pi instance between the read and the rename is silently lost — including keys unrelated to pi-recap.
- 0.5.0 widens the exposure: writes now also happen without user action, from the preflight thinking-level clamp save that fires on background auto-recap ticks (`src/generate.ts:150-165`), and the fixed shared tmp path means two concurrent saves overwrite each other's tmp file with last-rename-wins.
- Constraint verified: `SettingsManager` exposes only typed setters for known settings fields, with no generic write API for extension keys like `piRecap`, so the raw write is currently the only option — the fix is narrowing the race, not switching APIs.
  **Evidence:**
- `src/config.ts:187-191` confirmed (whole-file replace, fixed tmp path); `settings-manager.d.ts` surface confirmed by two independent reviewers.
  **Fix:**
- Use a unique tmp filename (pid/random suffix); keep the read-to-rename window minimal by reading immediately before writing. Consider applying the preflight clamp in memory only and persisting it on user-initiated writes, which removes the unprompted background writes entirely.

**Issue 5** - Version gate throws instead of degrading on hosts that don't export `VERSION`
**Severity**: Medium
**Confidence**: 65/100 (included by judgment: the trigger is exactly the population the gate exists for, and the fix is one line)
**Category:** Bug
**File:** `src/index.ts:4`, `src/index.ts:205`, `src/config.ts:79-93`
**Findings:**

- The gate's purpose is to run on an older Pi and disable politely with "pi-recap requires Pi >= 0.80.10 … recap is disabled." But on any host version predating the `VERSION` export, jiti's ESM→CJS interop yields `undefined` for the named import, and `isVersionAtLeast(undefined, ...)` throws `TypeError` at `version.split` (`src/config.ts:80`) — synchronously inside `registerPiRecap`, before the gate's notify handler is registered.
- Verified consequence: pi's loader catches factory throws and reports `Failed to load extension: <message>` (`pi-coding-agent dist/core/extensions/loader.js:362-368`) — the user gets a cryptic TypeError instead of the intended guidance. Uncertainty: I could not verify offline whether any released Pi version actually lacks the `VERSION` export; if it has always existed, the trigger population may be empty.
  **Evidence:**
- `src/index.ts:205` `dependencies.version ?? VERSION` with no type guard; `parseVersionParts` calls `.split` unconditionally; loader catch behavior read from installed pi source.
  **Fix:**
- `const raw = dependencies.version ?? VERSION; const version = typeof raw === "string" ? raw : "0.0.0";` — or make `parseVersionParts` accept `unknown` and return `null` for non-strings. Add a non-string case to `scripts/test-baseline.ts`.

**Issue 6** - Empty-conversation feedback regressed to silence for startup and compaction recaps
**Severity**: Medium
**Confidence**: 85/100
**Category:** Requirements gap
**File:** `src/index.ts:322-325` (spec: `docs/specs/spec_0_5_0.md:204`)
**Findings:**

- The empty-conversation branch notifies only when `trigger === "manual"`; startup (resume/fork) and compaction triggers return silently. The spec's "Existing behavior retained" bullet says "A configured model that is unavailable or unauthenticated, an empty conversation, and an empty response continue to produce user-visible feedback" with no trigger qualification — unlike the null-model rule, which the spec explicitly splits by trigger. The other two items in that bullet do notify on every trigger; empty conversation is the odd one out.
- At the base ref, `runRecap` notified "Nothing to recap yet" unconditionally (verified via `git show d1e9d8c:src/index.ts` line 165), and resume/fork/compaction recaps were forced runs — so this is a behavior regression, not just a spec-text mismatch.
  **Evidence:**
- New guard re-read at `src/index.ts:318-327`; base behavior confirmed from the base blob; `scripts/test-index.ts` asserts only the manual-trigger notification.
  **Fix:**
- Notify for `startup` and `compaction` triggers as well (keeping `auto` silent is defensible spam-avoidance and is usually short-circuited by leaf-ID dedup anyway), or amend the spec bullet to scope empty-conversation feedback to manual refresh.

**Issue 7** - Core lifecycle and in-flight concurrency paths of `registerPiRecap` have zero test coverage
**Severity**: Medium
**Confidence**: 90/100
**Category:** Test gap
**File:** `scripts/test-index.ts:326,336-339`, `src/index.ts:295,313-316,343-346,365,452-461`
**Findings:**

- The harness completion resolves immediately and `waitForBackgroundTasks()` drains before every assertion, so no test can interleave an event with an in-flight recap. Untested as a result: the stale-result guards after preflight (`src/index.ts:313-316`) and after generation (`343-346`), the `loadingShown && alive && myGeneration === generation` widget guard (`365`), and the `pending` in-flight dedup (`295`). All three guard blocks carry `eslint-disable @typescript-eslint/no-unnecessary-condition` — lint believes they are unreachable, so deleting any of them is lint-clean, type-clean, and keeps all nine suites green while breaking real behavior (stale recap re-rendered over the editor after `markActive`, `lastRecapEntryId` committed from a stale leaf, widget resurrected after shutdown).
- `session_shutdown` is never emitted in any test (grep-confirmed): the teardown at `src/index.ts:452-461` and the post-shutdown `!alive` guards on `input`/`turn_start`/`agent_end`/`session_compact` are entirely unverified. A regression dropping `alive = false` or `clearIdleTimer()` leaves an armed timer driving `runRecap` against a dead session's UI, and nothing would catch it.
- `state.idle` is never set `false` (grep-confirmed), so the tick's not-idle branch (`src/index.ts:387-391`) and every `if (ctx.isIdle())` reschedule guard are dead under test; a break there would generate recaps during user activity.
  **Evidence:**
- Harness re-read; greps for `session_shutdown` and idle mutation in `scripts/test-index.ts` confirmed zero hits; eslint-disable markers confirmed in `src/index.ts`.
  **Fix:**
- Add a deferrable completion to the harness (queue of manually resolved promises). Tests: start a recap, then before resolving (a) emit `input`, (b) emit `session_shutdown`, (c) mutate `state.leafId` — resolve and assert no widget render and unchanged `lastRecapText`/`lastRecapEntryId`; (d) fire `/recap` twice while unresolved, assert one completion. Add a shutdown test (timer armed → shutdown → `timers.count() === 0`, last widget call cleared, subsequent events no-op) and a non-idle tick test (`idle = false`, advance, assert zero completions and a rescheduled timer).

**Issue 8** - `saveRecapConfig` failure branches untested (fresh install, corrupt file)
**Severity**: Medium
**Confidence**: 85/100
**Category:** Test gap
**File:** `scripts/test-config.ts:155-196`, `src/config.ts:175-185`
**Findings:**

- Every harness pre-writes a valid `settings.json`, so three branches are never hit: ENOENT (start from `{}` — a fresh install's first `/recap model ...` takes this path; a regression in the errno check at `src/config.ts:182` breaks saving for every new user), invalid JSON (must throw "refusing to overwrite" and leave the file intact — this refusal is the only thing standing between a hand-edited settings.json and it being clobbered by `renameSync`), and non-object root (same refusal).
  **Evidence:**
- `scripts/test-config.ts` re-read; both the ENOENT and refusal branches confirmed unreached by any suite.
  **Fix:**
- Three temp-dir cases: no file → save succeeds and file contains only `piRecap`; invalid JSON → `assert.throws(/refusing to overwrite/)` and byte-identical file afterwards; root `[]` → same refusal.

**Issue 9** - Duplicated helpers across the new modules, two with behavioral divergence
**Severity**: Medium
**Confidence**: 95/100
**Category:** Pattern violation
**File:** `src/config.ts:167`, `src/index.ts:117,195-199`, `src/generate.ts:113-118`, `src/settings-menu.ts:148,186`, `src/commands.ts:57`
**Findings:**

- `errorMessage` is defined identically in all four source modules.
- `parseCustomNumeric` (`settings-menu.ts:186`) duplicates `parsePositiveSafeInt` (`commands.ts:57`) token-for-token, with a value-level twin `isPositiveSafeInteger` in `config.ts:53`. Both parse the same three settings fields via different entry points (typed command vs menu custom input), so drift means the two input paths accept different values for the same field.
- Two private `modelLabel(config)` functions disagree on null: `generate.ts` returns `""` (a branch that is unreachable at its call sites — dead code), `index.ts` returns `"(none)"`. Same name, different output is a trap for the next caller.
- Related drift already visible: the thinking-clamp notification has four phrasings across `generate.ts:156`, `index.ts:539`, `index.ts:575`, and `settings-menu.ts:245` — the last is the only user-facing string that lowercases the canonical CONTEXT.md term ("thinking level clamped" instead of "Recap Thinking Level").
  **Evidence:**
- All duplicates grep-confirmed; `generate.ts` null-branch unreachability traced (early return at `preflightRecap` before any `modelLabel` call).
  **Fix:**
- Export `errorMessage`, one positive-safe-int parser, and a single `modelLabel(ref: RecapModelRef | null)` from `config.ts` (everything already imports it); align `settings-menu.ts:245` to "Recap Thinking Level".

**Issue 10** - Test fixture builders duplicated across three suites, already drifting
**Severity**: Medium
**Confidence**: 80/100
**Category:** Test gap
**File:** `scripts/test-index.ts:34-41,211-268`, `scripts/test-gates.ts:21-64`, `scripts/test-menu.ts:36-99`
**Findings:**

- `makeModel`, `makeResponse`, `FakeRegistry`, `Notice`, and `DEFAULT_CONFIG` are re-implemented per suite (~150 lines of near-identical setup), with drift already present: test-gates' `makeModel` omits `thinkingLevelMap`, and the two `FakeRegistry` variants differ. A change to pi's `Model` shape must be applied in three places, and a stale copy lets one suite keep passing against an outdated model shape.
  **Evidence:**
- Builders compared across the three files; drift points confirmed.
  **Fix:**
- Extract a shared `scripts/test-support.ts` for the model/response builders, registry fake, and canonical default config (keeping test-config's independent `DEFAULT_CONFIG` if intended as an independent derivation of spec defaults).

## Documentation & Artifact Recommendations

- **File**: `README.md` (or a new `CHANGELOG.md`)
  **Recommendation**: Document the 0.5.0 breaking removals in one place: `--recap-*` CLI flags removed, legacy `/recap on|off|interval|recent` subcommands removed (with their canonical replacements), the `effort` key no longer read, and `piRecap` being normalized to the new schema (unknown keys dropped) on any save.
  **Reason**: README currently documents value migration but not the command/flag removals; upgrading users hitting "unknown subcommand" have no single reference for what changed.

- **File**: `AGENTS.md`
  **Recommendation**: Replace "all nine assertion-based Bun suites" with a count-free phrasing ("the `scripts/test-*.ts` suites via `pnpm test`").
  **Reason**: The hardcoded count goes stale on the next suite added or merged.

## Verdict

**Needs work** — ten Medium findings, no High/Critical. The feature work is complete and traces cleanly to the spec; the issues are hardening (unhandled rejections, sanitization, timeouts, write race), one behavior regression (empty-conversation feedback), and targeted test-coverage gaps around the lifecycle machinery.
