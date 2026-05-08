# pi-recap — Implementation Plan

This plan turns [spec.md](./spec.md) into a buildable sequence of milestones.
Each milestone has a clear "done" condition and a manual verification step
the user can run. Build top-to-bottom; later milestones depend on state shape
established earlier.

The agent does not run the extension — verification steps are written so the
user can execute them after each milestone lands.

## Milestone 0 — Project scaffold

**Goal:** an installable, runnable extension that does nothing useful but loads
cleanly under `pi -e ./pi-recap`.

Steps:

1. Create the package layout:
   ```
   pi-recap/
   ├── package.json
   ├── docs/
   │   ├── spec.md              # already exists
   │   └── plan.md              # this file
   ├── src/
   │   └── index.ts
   ├── .gitignore               # node_modules, *.log
   └── README.md                # short pointer to docs/
   ```
2. `package.json` (modeled on `examples/extensions/with-deps/`):

   ```json
   {
     "name": "pi-recap",
     "private": true,
     "version": "0.1.0",
     "type": "module",
     "keywords": ["pi-package"],
     "pi": {
       "extensions": ["./src/index.ts"]
     },
     "peerDependencies": {
       "@earendil-works/pi-coding-agent": "*",
       "@earendil-works/pi-ai": "*",
       "@earendil-works/pi-tui": "*"
     },
     "devDependencies": {
       "typescript": "^5.6.0"
     },
     "scripts": {
       "check": "tsc --noEmit"
     }
   }
   ```

   Notes:
   - `peerDependencies` uses `"*"` for the three pi packages we import,
     per pi's
     [packages.md](file:///Users/stacktrace/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/packages.md):
     pi resolves those at runtime against whatever pi is installed. npm 7+
     auto-installs peer deps, so local typecheck finds them via
     `node_modules/`. Commit `package-lock.json` for reproducibility.
   - `typebox` is dropped — pi-recap doesn't register tools or define
     schemas, so it isn't imported anywhere.
   - `keywords: ["pi-package"]` is present from M0 for gallery discoverability.

3. `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ES2022",
       "moduleResolution": "bundler",
       "strict": true,
       "noEmit": true,
       "esModuleInterop": true,
       "skipLibCheck": true,
       "types": ["node"]
     },
     "include": ["src/**/*.ts", "scripts/**/*.ts"]
   }
   ```
   Required for `tsc --noEmit` to resolve pi's ESM exports correctly.
   `moduleResolution: "bundler"` matches how jiti loads at runtime.
4. `src/index.ts` minimum:

   ```typescript
   import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

   export default function piRecap(pi: ExtensionAPI) {
     pi.on("session_start", (_e, ctx) => {
       if (!ctx.hasUI) return;
       ctx.ui.notify("pi-recap loaded", "info");
     });
   }
   ```

5. `npm install` inside `pi-recap/`.
6. `npm run check` passes.

**User verifies:** `pi -e ./pi-recap` starts, shows the `pi-recap loaded`
toast, exits cleanly.

## Milestone 1 — Static widget

**Goal:** render the literal `Recap: hello world` line above the editor in
italics, with no model calls yet.

Steps:

1. In `session_start`, after the `ctx.hasUI` guard, call:

   ```typescript
   import { Text } from "@earendil-works/pi-tui";

   ctx.ui.setWidget(
     "pi-recap",
     (_tui, theme) => new Text(theme.italic("Recap: hello world"), 0, 0),
     { placement: "aboveEditor" }
   );
   ```

   Use the `Text` component (not an inline `{ render, invalidate }`) so pi
   handles `render(width)` and ANSI-aware word-wrapping. `Component.render`
   takes `width: number` and returns `string[]`; an inline `() => [line]`
   compiles but ignores width and a long recap will overflow the terminal
   width.

2. Clear the widget on `session_shutdown`:
   ```typescript
   pi.on("session_shutdown", (_e, ctx) => {
     ctx.ui.setWidget("pi-recap", undefined);
   });
   ```

**User verifies:** `pi -e ./pi-recap` shows the italic line above the input.
Resize the terminal narrower than the line — it wraps cleanly. `/new` clears
it; restarting shows it again.

## Milestone 2 — Conversation extraction

**Goal:** produce a plain-text rendering of the current branch with
recency bias and compaction-awareness, ready to feed to a model.

1. Port the helpers from `examples/extensions/summarize.ts`
   (`extractTextParts`, `extractToolCallLines`, `buildConversationText`)
   into `src/conversation.ts`. Don't depend on the example.

2. **Extend the entry-type filter to include compaction summaries.** The
   `summarize.ts` baseline only handles `entry.type === "message"`, which
   silently drops `CompactionEntry` (`type: "compaction"`). Without a fix,
   after pi compacts the session, the extractor sees only the few entries
   kept after `firstKeptEntryId`, and the recap loses everything pre-cut.
   Add a branch:

   ```typescript
   if (entry.type === "compaction" && typeof entry.summary === "string") {
     sections.push(`Earlier (compacted): ${entry.summary.trim()}`);
     continue;
   }
   ```

   This treats the compaction summary as a synthetic earliest "message" that
   the model can use to anchor a recap.

3. Add the recency-truncation step:

   ```typescript
   // src/conversation.ts
   const APPROX_CHARS_PER_TOKEN = 4;
   const RECENT_BUDGET_TOKENS = 6_000;

   export function buildRecentConversationText(entries: SessionEntry[]): string {
     // Walk entries from newest to oldest, accumulating text until we hit
     // the budget. Reverse the kept slice so the prompt reads
     // chronologically. The first walked entry is always kept even if it
     // alone exceeds the budget — guarantees at least one entry of context.
     const budgetChars = RECENT_BUDGET_TOKENS * APPROX_CHARS_PER_TOKEN;
     const kept: SessionEntry[] = [];
     let used = 0;
     for (let i = entries.length - 1; i >= 0; i--) {
       const slice = buildConversationText([entries[i]!]);
       if (slice.length === 0) continue;
       used += slice.length;
       kept.unshift(entries[i]!);
       if (used >= budgetChars) break;
     }
     return buildConversationText(kept);
   }
   ```

   Note that the budget is measured against `buildConversationText`'s
   formatted output (with `User:`/`Assistant:` prefixes), so it's slightly
   conservative versus raw token count — fine for a soft cap.

4. Smoke test as a script (no test framework yet):
   - `scripts/test-extract.ts` builds three fake `entries` arrays and prints
     the output:
     1. 50 turns of plain user/assistant messages → recent-only survives.
     2. A `CompactionEntry` followed by 3 messages → both the compaction
        summary AND the recent messages appear in the output.
     3. A single oversized message → kept on its own, exceeds budget.
   - Run with `bun run scripts/test-extract.ts`.

**User verifies:** the smoke script output for case 2 shows
`Earlier (compacted): ...` followed by the post-compaction messages in
chronological order. Case 1 shows only the most recent entries.

## Milestone 3 — Manual `/recap` command (no auto-refresh, no overrides)

**Goal:** typing `/recap` calls the active model, gets back a recap, and
updates the widget.

Steps:

1. Move the widget renderer into a `setRecap(text: string | undefined, ctx)`
   helper so the command and (later) the timer can share it.
   - When `text` is a string: build a `Text` component
     `new Text(theme.italic("Recap: " + text), 0, 0)` and pass it to
     `ctx.ui.setWidget("pi-recap", factory, { placement: "aboveEditor" })`.
   - When `text` is `undefined`: call `ctx.ui.setWidget("pi-recap", undefined)`.

2. Register the command:

   ```typescript
   pi.registerCommand("recap", {
     description: "Refresh the session recap shown above the editor",
     handler: async (_args, ctx) => {
       await runRecap(ctx, { force: true });
     }
   });
   ```

3. Implement `runRecap`:
   - Build conversation text via `buildRecentConversationText`.
   - If empty, `ctx.ui.notify("Nothing to recap yet", "info")` and return.
   - Resolve the model: for now, just `ctx.model`. (Provider/model overrides
     come in M5.) If `ctx.model` is `undefined`, notify and return.
   - Resolve auth:
     ```typescript
     const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
     if (!auth.ok) {
       ctx.ui.notify(`Recap: ${auth.error}`, "warning");
       return;
     }
     if (!auth.apiKey) {
       ctx.ui.notify("Recap: no API key for active model", "warning");
       return;
     }
     ```
     `ResolvedRequestAuth` is a discriminated union
     (`{ ok: true, apiKey?, headers? } | { ok: false, error }`); reading
     `.apiKey` without checking `.ok` first will silently pass `undefined`
     to `complete()` and surface as a confusing provider error.
   - Call `complete(model, { messages: [...] }, { apiKey: auth.apiKey,
headers: auth.headers, reasoningEffort: "low" })`.
   - System prompt for the model (literal):
     ```
     Write a recap of the conversation in 50 words or fewer.
     Lean toward what just happened — the last few exchanges should dominate.
     Avoid restating early background unless it is directly relevant right now.
     One paragraph, no bullets, no markdown headings.
     Do not start with the word "Recap" — that prefix will be added for you.
     ```
   - Post-process the response:
     - Concatenate text blocks, `trim()`.
     - Strip a leading `Recap:` (case-insensitive, optional whitespace) if
       the model added one.
     - Enforce the 50-word cap by splitting on `/\s+/`, slicing to 50, and
       appending `…` if truncated.
   - Call `setRecap(text, ctx)`.

4. Failure paths:
   - `complete()` throws → `ctx.ui.notify("Recap failed: <message>", "error")`,
     leave the previous widget in place.

**User verifies:**

- Have a 5+ turn conversation.
- Run `/recap`.
- Widget updates to a single italic line ≤ 50 words. (We're not yet
  validating recency-bias quality at this milestone — that follows naturally
  from M2's extractor, but the M3 verification only confirms the round-trip
  works.)
- Run `/recap` again with no new turns: it still re-runs (force=true).

## Milestone 4 — Dirty-check, lifecycle reset, and re-entrancy

**Goal:** avoid re-running the model when the conversation hasn't changed,
and make sure state is correct across `session_start`/`session_shutdown`
cycles.

Steps:

1. Closure state (declared at the factory's top scope):

   ```typescript
   let lastRecapText: string | undefined;
   let lastRecapEntryId: string | null = null; // getLeafId() returns string | null
   let pending: Promise<void> | null = null;
   let alive = false;
   ```

2. **Reset state on every `session_start`** (factory-scoped closure means
   state persists across `session_shutdown` → `session_start` cycles for
   `/new`, `/resume`, `/fork`):

   ```typescript
   pi.on("session_start", (_e, ctx) => {
     if (!ctx.hasUI) return;
     lastRecapText = undefined;
     lastRecapEntryId = null;
     pending = null;
     alive = true;
     // ... existing M1 widget setup, settings load, etc.
   });
   ```

   Without this reset, a stale `lastRecapEntryId` from the previous session
   would equal the current `getLeafId()` only by accident, but the dirty
   check could still misbehave; the explicit reset makes intent
   load-bearing.

3. **Mark dead on shutdown:**

   ```typescript
   pi.on("session_shutdown", (_e, ctx) => {
     alive = false;
     if (intervalHandle) {
       clearInterval(intervalHandle);
       intervalHandle = null;
     }
     ctx.ui.setWidget("pi-recap", undefined);
   });
   ```

4. Capture the current leaf id at the start of every `runRecap` and
   re-check `alive` after every `await`:

   ```typescript
   async function runRecap(ctx, { force }) {
     if (!alive) return;
     const leafId = ctx.sessionManager.getLeafId();
     if (!force && leafId === lastRecapEntryId) return;

     if (pending) {
       await pending;
       return;
     }
     pending = (async () => {
       // ... build text, resolve auth, await complete() ...
       if (!alive) return; // session was swapped out while we awaited
       // ... post-process, setRecap ...
     })();
     try {
       await pending;
     } finally {
       pending = null;
     }
   }
   ```

5. On success, update both `lastRecapText` and `lastRecapEntryId`.

**User verifies:**

- `/recap` (force) runs the model.
- Second `/recap` immediately runs again (still force=true from command).
- A timer-style call with `force=false` and no new entries returns instantly
  (during dev, expose a temporary `pi-recap-debug` command that calls
  `runRecap(ctx, { force: false })` and notifies "skipped" or "ran"; remove
  before M8).
- After `/new`, the next `/recap` runs the model successfully (proves the
  state reset works — without it, the empty session's `getLeafId()` could
  spuriously equal `lastRecapEntryId` from before).

## Milestone 5 — Configuration & overrides

**Goal:** wire up settings, CLI flags, and `/recap key=value` arguments per the
spec's [override resolution order](./spec.md#override-resolution-order).

Steps:

1. **Defaults** as a top-level `const`:
   ```typescript
   const DEFAULTS = {
     provider: undefined,
     model: undefined,
     effort: "low",
     intervalMs: 300_000,
     wordLimit: 50
   } as const;
   ```
2. **Settings.json reader.** Use `SettingsManager` from
   `@earendil-works/pi-coding-agent`:

   ```typescript
   import { SettingsManager } from "@earendil-works/pi-coding-agent";

   const sm = SettingsManager.create(ctx.cwd);
   const merged = { ...sm.getGlobalSettings(), ...sm.getProjectSettings() };
   const raw = (merged as any).piRecap as unknown;
   const piRecap = validatePiRecapSettings(raw); // returns Partial<RecapConfig>
   ```

   `validatePiRecapSettings` must be total over arbitrary input — every
   shape it accepts must round-trip safely:
   - `undefined` (no `piRecap` key in settings) → return `{}`.
   - non-object (string, number, array, null) → return `{}`.
   - object with unknown keys → ignore them, return only the recognised
     fields.
   - object with recognised keys but wrong types
     (e.g. `intervalMs: "5min"`) → drop just those fields, keep the rest.
     The precedence chain in step 5 then falls through to the next layer for
     anything dropped. No exception should ever escape this function — a
     malformed user settings file must not crash extension load.

3. **CLI flags** via `pi.registerFlag` for `recap-provider`, `recap-model`,
   `recap-effort`, `recap-interval` (see spec).
4. **Argument parser** for `/recap`:
   ```typescript
   function parseRecapArgs(
     raw: string
   ): { ok: true; overrides: Partial<RecapConfig> } | { ok: false; error: string };
   ```
   Splits on whitespace, validates `key=value`, validates `effort` against the
   thinking-level enum, and rejects partial provider/model pairs (must be both
   or neither).
5. **Resolution function** `resolveConfig(ctx, overrides)` implementing the
   precedence chain and returning a fully-typed `RecapConfig`. The active
   session model fallback (`ctx.model`) lives here.

**User verifies:**

- `/recap effort=high` runs once with `reasoningEffort: "high"` (instrument
  during dev).
- `/recap provider=anthropic` reports `"provider and model must be set together"`.
- `/recap nonsense=1` reports `"Unknown key: nonsense"`.
- Setting `piRecap.intervalMs` in `~/.pi/agent/settings.json` to `60000` is
  reflected by the next milestone's timer.

## Milestone 6 — Auto-refresh timer

**Goal:** widget refreshes every `intervalMs` while pi is idle.

Steps:

1. Closure state additions (already declared in M4 alongside `alive`):
   ```typescript
   let intervalHandle: ReturnType<typeof setInterval> | null = null;
   ```
2. In `session_start`, if `intervalMs > 0`:

   ```typescript
   intervalHandle = setInterval(async () => {
     if (!alive) return; // session shut down between ticks
     if (!ctx.isIdle()) return; // skip while streaming
     try {
       await runRecap(ctx, { force: false });
     } catch (err) {
       ctx.ui.notify(`Recap tick failed: ${(err as Error).message}`, "warning");
     }
   }, intervalMs);
   ```

   The `!alive` guard plus the `alive` re-check inside `runRecap` (from M4)
   together prevent a tick that started before shutdown from writing to a
   widget on the dead session.

3. In `session_shutdown`, `clearInterval(intervalHandle); intervalHandle = null`
   (already added in M4).

4. After every successful `/recap` command, **reset** the interval (clear
   and re-create) so the next tick is `intervalMs` from now, not
   `intervalMs` from `session_start`.

**User verifies:**

- Set `intervalMs=15000` in dev. Have a conversation, watch the widget refresh
  ~every 15s. Make sure it does not refresh while the agent is mid-stream.
- Disable with `--recap-interval 0`. No background ticks fire.

## Milestone 7 — Compaction handling

**Goal:** the recap survives pi compaction.

When pi compacts a session, most entries are replaced by a single
`CompactionEntry { type: "compaction", summary, firstKeptEntryId }` plus
the entries kept after the cut. M2's extractor was already updated to
include `Earlier (compacted): <summary>` as a synthetic line, so the
extracted conversation text remains useful. This milestone wires up the
`session_compact` event so the recap actively refreshes after compaction.

Steps:

1. Add a `session_compact` handler:
   ```typescript
   pi.on("session_compact", async (_event, ctx) => {
     if (!alive) return;
     // Compaction replaces the entry list; the dirty-check would otherwise
     // see a "new leaf" anyway, but the previous lastRecapEntryId now points
     // at an entry that may no longer be on the active branch. Force a
     // rebuild from scratch.
     lastRecapEntryId = null;
     queueMicrotask(() => runRecap(ctx, { force: true }));
   });
   ```
2. M2's extractor already handles the `CompactionEntry` branch, so the
   prompt sent to the recap model includes `Earlier (compacted): ...`
   followed by any post-compaction messages. No prompt-template change
   required.

**User verifies:**

- Trigger compaction (run `/compact`, or fill enough context that
  auto-compaction kicks in).
- Within a second, the recap widget refreshes to a recap that mentions both
  earlier topic context (from the compaction summary) and the most recent
  exchange (from post-cut messages).

## Milestone 8 — Polish & remaining edge cases

**Goal:** the smaller spec items, in priority order.

1. **Resume / fork sessions**: in `session_start` with `reason === "resume"`
   or `reason === "fork"`, kick off `runRecap({ force: true })` via
   `queueMicrotask(...)` so the initial render isn't blocked. Both inherit
   a populated branch and benefit from an immediate "where were we?" line.
2. **Non-reasoning models**: if `model.reasoning === false`, drop
   `reasoningEffort` from the `complete()` options regardless of the
   configured effort. Strip silently — no warning, no notification. The
   user already accepted this trade-off when they chose the model.
3. **Word-cap sanity**: if the post-processed text is empty (model
   returned no text), do not update the widget. Notify once.
4. **Prefix dedup**: strip a leading `Recap:` (case-insensitive, optional
   whitespace) from the model's output, since the widget supplies the
   prefix. Already required by M3's post-processing — make sure it's
   actually implemented.
5. **Custom message exclusion**: when extracting conversation text, skip
   `CustomEntry`, `CustomMessageEntry` with `customType === "pi-recap"` if
   we ever inject any. (We don't today, but the filter is cheap insurance.)

**User verifies (manual checklist):**

- [ ] Recap appears immediately on resume of a long session.
- [ ] Recap appears immediately after `/fork` from a populated parent
      session.
- [ ] Switching to a non-reasoning model (e.g. `gpt-4o`) and running
      `/recap effort=high` produces a recap with no warning toast and no
      provider error.
- [ ] Forcing the model to start with "Recap: …" via prompt injection
      still results in exactly one `Recap: ` prefix in the widget.

## Milestone 9 — Distribution

**Goal:** the extension is installable from the local path with `pi install`
and from a git remote.

Steps:

1. Add a top-level `README.md` with: install instructions
   (`pi install /path/to/pi-recap`), the `/recap` syntax, the
   `settings.json` keys, and a screenshot of the widget if practical.
2. Confirm `keywords: ["pi-package"]` is present (added back at M0).
3. Remove the temporary `pi-recap-debug` command introduced in M4.
4. Run `pi install ./pi-recap` from a scratch directory and confirm the
   extension auto-loads on the next `pi` start.
5. Push to a personal git remote and run `pi install git:<remote>` to
   confirm the package layout works without local-path special casing.

**User verifies:** in a fresh `pi` session with no `-e` flag, the recap
widget appears and `/recap` is in the command palette.

## Out of scope for v1

These are deliberately deferred:

- Persisting `lastRecapText` across restarts (re-running on session start is
  cheap enough).
- Showing a spinner / placeholder while a recap is regenerating.
- Letting the user pin a recap or scroll through past recaps.
- Localizing the prompt or output (everything is English).
- A `/recap save=true` mode that promotes ad-hoc overrides into persistent
  config.
