# pi-recap — Specification

## Overview

`pi-recap` is a pi extension that displays a short, recency-biased recap of the
current session as a widget above the editor and refreshes it on a timer. The
recap text is rendered in italics and prefixed with `Recap: `. Users can also
trigger a fresh recap manually with `/recap`.

## Goals

- Give the user a glanceable answer to "what's been happening lately?" without
  scrolling the transcript or running `/summarize`.
- Bias the summary toward the most recent turns so it stays useful as the
  conversation grows.
- Keep cost predictable: cap the recap at **50 words** and only call the model
  when the conversation has actually changed.
- Let the user pick which model produces the recap (it should not be forced to
  use the active session model) and how hard it should think about it.

## Non-goals

- Replacing `/summarize` or `/compact`. Those produce long, structured
  summaries; pi-recap produces a single tweet-sized line.
- Persisting recaps across sessions. The recap is recomputed on demand.
- Modifying the LLM context. The recap is for the human; it never enters the
  agent's message history.

## User-visible behavior

### Widget above the editor

While a recap is available, an `aboveEditor` widget shows a single italicized
line:

```
Recap: <up to ~50 words biased toward the most recent activity>
```

- Rendered with `ctx.ui.setWidget("pi-recap", …, { placement: "aboveEditor" })`.
- Text is wrapped in `theme.italic(...)`. The literal prefix `Recap: ` is also
  italicized.
- If the recap exceeds the terminal width, it wraps onto the next line; pi-recap
  does not truncate the text — the 50-word cap is enforced at generation time.
- The widget is cleared when the recap text would be empty (e.g. brand new
  session before the first turn finishes).
- pi-recap is **interactive-only** for v1. All widget setup, command
  registration, and timer work is gated on `ctx.hasUI`. RPC mode is a no-op.
  This keeps scope tight; RPC support can be added later without a redesign.

### `/recap` command

Registered via `pi.registerCommand("recap", …)`. Runs in interactive and RPC
mode.

Usage:

```
/recap                                  # regenerate using configured defaults
/recap provider=anthropic model=claude-sonnet-4-5
/recap effort=high
/recap provider=openai model=gpt-5.2 effort=medium
```

Argument grammar:

- Whitespace-separated `key=value` pairs. Unknown keys produce a
  `ctx.ui.notify(..., "warning")` and the command aborts.
- Keys (all optional): `provider`, `model`, `effort`.
- `effort` must be one of `off | minimal | low | medium | high | xhigh`. These
  are the same levels pi exposes via `pi.setThinkingLevel()`. The extension
  forwards the value as `reasoningEffort` when calling the model.
- If only one of `provider` / `model` is supplied, the command errors out;
  selecting a model requires both.

Behavior:

1. Resolve the effective config (CLI args > per-session overrides > settings >
   defaults).
2. Build conversation text from `ctx.sessionManager.getBranch()` using the
   recency-biased extraction described under
   [Recap content rules](#recap-content-rules).
3. Call the configured model via `complete(...)` from `@earendil-works/pi-ai`,
   passing `reasoningEffort` from the resolved config.
4. Update the widget and reset the auto-refresh timer (so the user does not get
   another refresh seconds later).
5. Notify on failure (`ctx.ui.notify("Recap failed: …", "error")`); leave the
   previous recap text in place rather than blanking it.

### Auto-refresh every 5 minutes

- Timer is started on `session_start` and cleared on `session_shutdown`.
- Default interval: **300_000 ms** (5 minutes). Configurable, see
  [Configuration](#configuration). An interval of `0` disables auto-refresh.
- A tick is **skipped** (no model call, widget unchanged) when:
  - The session has no new entries since the last successful recap.
  - There is no model/API key available to run the recap.
- A tick is **deferred** while:
  - The agent is mid-stream (`ctx.isIdle()` is false). The next scheduled
    tick will pick up the work; we do not separately re-fire a "missed" tick.
    This avoids stealing tokens or racing with active tool execution.
- When a tick fails, the extension logs via `ctx.ui.notify(..., "warning")` once
  and does not retry until the next scheduled tick.

The widget never displays a stale "spinner"; pi-recap simply leaves the previous
recap visible until a fresh one is ready, then swaps it in.

### Resume / fork behavior

When `session_start` fires with `reason: "resume"` or `reason: "fork"`,
pi-recap kicks off an immediate recap (force=true) so the user sees a
"where were we?" line as soon as the editor renders. Both reasons inherit a
populated branch and benefit equally from an immediate recap. This is one
extra cheap model call per resume/fork; the trade-off favours user value.
New (`reason: "new"`) and reload (`reason: "reload"`) sessions follow the
normal rules — first recap appears either on the next `/recap` invocation or
the first scheduled tick that has any conversation content to summarise.

## Recap content rules

### Source of truth

Use `ctx.sessionManager.getBranch()` to walk the active conversation branch.
Extract:

- **`type: "message"` entries** with `role: "user"` or `role: "assistant"`:
  text parts, plus tool call summaries from assistant messages (one line per
  call, e.g. `Tool bash was called with args {...}`). This matches
  `summarize.ts`'s `buildConversationText` pattern.
- **`type: "compaction"` entries**: include the `summary` field as a
  pseudo-message, e.g. `Earlier (compacted): <summary>`. Without this, after
  compaction the entire pre-compaction conversation is invisible to the
  extractor and the recap loses everything that happened before the cut.

Tool result messages (`role: "toolResult"`) are intentionally dropped. Their
content is often huge (file dumps, command output) and the assistant's
follow-up text usually paraphrases the relevant outcome anyway. Including
them would blow the recency budget without adding much.

### Recency bias

Two complementary mechanisms:

1. **Truncate to the recent window.** Keep only the trailing N entries that fit
   under a budget of ~6_000 input tokens (rough cap; estimated as
   `chars / 4`). Older entries are dropped from the prompt. This is what makes
   the recap genuinely "recent" rather than a session digest.
2. **Prompt instruction.** The system instruction tells the model: _"Write a
   recap of at most 50 words. Lean toward what just happened — the last few
   exchanges should dominate. Avoid restating early background unless it is
   directly relevant right now."_

If the entire branch fits under the budget, no truncation happens and the
prompt notes that the conversation is short.

### Output shape

- Single paragraph, no bullet points, no markdown headings.
- ≤ 50 words. Enforced post-hoc by counting whitespace-separated tokens; if the
  model overshoots, pi-recap trims to the first 50 words and appends `…`.
- Stripped of leading/trailing whitespace and any leading `Recap:` prefix the
  model may have added (the widget supplies the prefix).

### Skip conditions

The recap call is skipped (and the existing widget left untouched) when the
extracted conversation text is empty after trimming. This handles fresh
sessions and sessions whose only entries are extension-injected custom messages.

## Configuration

Settings are read once on `session_start` and refreshed on `/reload`. Users may
also override per-invocation via `/recap` arguments.

### Per-user / per-project settings

Read from `settings.json` (project takes precedence over global, per pi's normal
rules):

```json
{
  "piRecap": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "effort": "low",
    "intervalMs": 300000,
    "wordLimit": 50
  }
}
```

All keys are optional. Defaults:

| Key          | Default                                          |
| ------------ | ------------------------------------------------ |
| `provider`   | `undefined` (falls back to active session model) |
| `model`      | `undefined` (falls back to active session model) |
| `effort`     | `"low"`                                          |
| `intervalMs` | `300000`                                         |
| `wordLimit`  | `50`                                             |

`wordLimit` is included for tunability but the spec mandates a default of 50
words; values above 50 should still be honoured if the user explicitly raises
them.

### CLI flags

Registered via `pi.registerFlag(...)`:

- `--recap-provider <name>`
- `--recap-model <id>`
- `--recap-effort <off|minimal|low|medium|high|xhigh>`
- `--recap-interval <ms>` (use `0` to disable auto-refresh)

Flag values shadow `settings.json` for the lifetime of the process.

### Override resolution order

1. `/recap` command arguments (only for that invocation; auto-refresh keeps
   using the persistent config unless the user runs `/recap save=true`, which
   is **not** in scope for v1).
2. CLI flags.
3. `settings.json` (`piRecap.*`).
4. Built-in defaults.
5. If no provider/model is resolved at any level, fall back to `ctx.model` —
   the session's active model.

## Implementation outline

```
pi-recap/
├── package.json          # peerDependencies on pi packages, name, "pi" manifest
└── src/
    └── index.ts          # default-export factory
```

Settings are read via the exported `SettingsManager` from
`@earendil-works/pi-coding-agent`:

```typescript
import { SettingsManager } from "@earendil-works/pi-coding-agent";

const sm = SettingsManager.create(ctx.cwd);
const merged = { ...sm.getGlobalSettings(), ...sm.getProjectSettings() };
const piRecap = (merged as any).piRecap as Partial<PiRecapSettings> | undefined;
```

The `piRecap` block is not part of pi's typed `Settings` interface, so a cast
is required. We treat the cast as the boundary: validate every field returned
from it (provider/model are strings, effort is one of the thinking levels,
intervalMs is a non-negative number, wordLimit is a positive integer). Invalid
values fall through to the next layer of the precedence chain.

Key responsibilities of `src/index.ts`:

1. **State** (closure-scoped):
   - `lastRecapText: string | undefined`
   - `lastRecapEntryId: string | null` — the id of the most recent branch
     entry at the time of the last successful recap, used as a "dirty check".
     Initialized `null` because `getLeafId()` returns `string | null`.
   - `intervalHandle: ReturnType<typeof setInterval> | null`
   - `pending: Promise<void> | null` — guards against re-entrant runs.
   - `alive: boolean` — set `true` in `session_start`, `false` in
     `session_shutdown`. Async work guards on this before touching `ctx.ui`,
     because a tick that begins before shutdown may resolve after the new
     session has bound.

2. **`session_start` handler**:
   - If `!ctx.hasUI`, return early. pi-recap is interactive-only for v1.
   - **Reset all per-session state**: `lastRecapText = undefined`,
     `lastRecapEntryId = null`, `pending = null`, `alive = true`. Closure
     state is shared across sessions, so this reset is mandatory — without
     it, a stale `lastRecapEntryId` from the previous session can suppress
     the first recap of the new one.
   - Load settings via `SettingsManager`.
   - Render the widget once with whatever text is appropriate (empty session →
     no widget; resumed/forked session → kick off a recap).
   - When `event.reason === "resume"` or `event.reason === "fork"`, schedule
     `runRecap(ctx, { force: true })` via `queueMicrotask` so the initial
     render isn't blocked.
   - Start the auto-refresh interval if `intervalMs > 0`.

3. **`session_shutdown` handler**:
   - Set `alive = false`.
   - `clearInterval(intervalHandle); intervalHandle = null`.
   - Clear the widget.

4. **`session_compact` handler**:
   - Pi compaction replaces most session entries with a single
     `CompactionEntry { type: "compaction", summary }`. The conversation
     extractor only handles `type: "message"`, so post-compaction there is
     either no extractable text or only a few entries kept after
     `firstKeptEntryId`. Reset `lastRecapEntryId = null` so the next tick is
     allowed through the dirty-check, and trigger an immediate
     `runRecap(ctx, { force: true })`. The conversation builder must also be
     compaction-aware (see Recap content rules).

5. **`turn_end` handler**:
   - No work. The dirty-check on the next `runRecap` call uses
     `getLeafId()` directly; we don't need to mirror state per turn.

6. **`/recap` command handler**:
   - Parse arguments, resolve config, run `runRecap({ force: true })`.

7. **`runRecap({ force })`**:
   - If `!alive`, return.
   - If `pending` is set, await it and return.
   - If `!force` and `getLeafId()` equals `lastRecapEntryId`, return
     without calling the model.
   - Build conversation text with recency bias (compaction-aware — see
     [Recap content rules](#recap-content-rules)).
   - Resolve `model` via `ctx.modelRegistry.find(provider, modelId)` (or
     `ctx.model` as fallback). `ctx.modelRegistry.find` returns
     `Model | undefined`; if `undefined`, notify the user that the requested
     provider/model is unknown and abort.
   - Resolve api key via `await ctx.modelRegistry.getApiKeyAndHeaders(model)`.
     The return is a discriminated union
     `{ ok: true, apiKey?, headers? } | { ok: false, error }`. On `!ok`,
     notify with `auth.error` and abort. On `ok` but no `apiKey`, notify
     "no API key configured" and abort.
   - If `model.reasoning === false`, drop `reasoningEffort` from the
     `complete()` call regardless of the configured effort. Strip silently —
     no warning.
   - Call `complete(model, { messages: [...] }, { apiKey, headers,
reasoningEffort })` (omit `reasoningEffort` for non-reasoning models).
   - After `await`, re-check `alive`. If false, return without writing the
     widget — the session has been swapped out.
   - Post-process: trim, strip leading `Recap:`, enforce word cap.
   - Update widget via `ctx.ui.setWidget("pi-recap", (_, theme) => new
Text(theme.italic("Recap: " + text), 0, 0))`. Pi's `Text` component
     handles `render(width)` and word-wrapping for us.
   - Update `lastRecapText` and `lastRecapEntryId`.

8. **Widget renderer**:
   - Build a `Text` component:
     `new Text(theme.italic("Recap: " + lastRecapText), 0, 0)`.
   - The `Text` component implements `Component.render(width: number):
string[]` correctly, including word-wrapping with ANSI awareness.

## Error handling

- Missing API key for the configured provider → `notify("warning")` once per
  session, fall back to `ctx.model` for subsequent ticks.
- Network / provider error → `notify("warning")` once per failure, keep the old
  recap visible.
- Aborted via `ctx.signal` (e.g. user hits Esc during a recap call) →
  silently swallow; previous recap stays.
- Invalid `/recap` argument → `notify("warning", "Unknown key: foo")`, do not
  run.

## Examples reference

- Conversation extraction & model `complete` flow:
  `examples/extensions/summarize.ts`.
- Above-editor widget placement: `examples/extensions/widget-placement.ts`.
- Themed widget renderer: `examples/extensions/plan-mode/`.
- Interval timer pattern: `examples/extensions/mac-system-theme.ts`.
- CLI flag registration: `examples/extensions/preset.ts` and
  `pi.registerFlag(...)` in `docs/extensions.md`.
- Italic text: `theme.italic(text)` (see `docs/extensions.md` "Text styles").
