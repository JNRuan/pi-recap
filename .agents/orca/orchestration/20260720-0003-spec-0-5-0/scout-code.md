# Scout report: code comprehension + installed Pi API (0.74.0)

All @earendil-works packages installed at 0.74.0.

## src/config.ts (139 lines)

- Schema exactly `{provider, model, effort, intervalSeconds, wordLimit, recentMessageLimit}` (config.ts:6-13).
- loadSettingsPiRecap merges project over global `{...globalCfg, ...projectCfg}` (config.ts:62-68).
- parseRecapModel rejects multi-slash ids via `trimmed.includes("/", slash + 1)` (config.ts:70-85, rejection at :78).
- Save: read-modify-write, tmp file + renameSync (config.ts:99-123); getAgentDir from pi-coding-agent (config.ts:2, path at :100).

## src/index.ts (531 lines)

- Events: session_start, session_shutdown, input, turn_start, agent_end, session_compact (index.ts:316,359,371,377,382,387).
- Loading widget renders before model/auth gates: config guard (:147-153), `renderRecapWidget(loading:true)` at :158, model find at :169, auth at :178.
- RECAP_MODEL_UNSET_WARNING (index.ts:118-119) fires on session_start when no model (:334-336) and on forced runs (:148-152).
- Exactly 4 registerFlag calls: recap-provider/model/effort/interval (index.ts:296-314).
- Subcommands: config(:412), on(:424), off(:441), model(:454), interval(:476), messages/recent(:500), default=refresh(:518).
- Idle timer: `currentIntervalSeconds` (:251), `scheduleIdleRecap` (:260-268).
- Prompt (RECAP_SYSTEM_PROMPT :17-29) says "under 50 words"; code truncation uses config.wordLimit default 100 (config.ts:20; index.ts:220-223). Two different numbers today.
- Generation uses `complete` from pi-ai (:1, called :188); `reasoningEffort` only when `model.reasoning` (:203).
- Dedup/leaf: early return `!force && leafId === lastRecapEntryId` (:143); post-call leaf recheck (:210) + generation counter (:209).
- lastRecapText/lastRecapEntryId module-scope (:246-247), reset at session_start (:322-323), text cleared at shutdown (:363).

## src/conversation.ts (109 lines)

- Single export `buildRecentConversationText(entries, recentMessageLimit = 20)` (:88-109). Walks backwards, message entries user/assistant text only, "User:"/"Assistant:" prefixes, joined "\n\n".
- Compaction → "Earlier (compacted): {summary}", not counted toward limit (:48-53). Own custom pi-recap entries filtered (:55-57).

## Pi API at installed 0.74.0

pi-ai:

- `completeSimple(model, context, options?): Promise<AssistantMessage>` exported from ROOT (stream.d.ts:7), not /compat.
- `SimpleStreamOptions.reasoning: ThinkingLevel` (types.d.ts:87-88).
- `ThinkingLevel = "minimal"|"low"|"medium"|"high"|"xhigh"` (types.d.ts:8) — NO "max" at 0.74.0. `ModelThinkingLevel = "off" | ThinkingLevel` (types.d.ts:9).
- `getSupportedThinkingLevels`, `clampThinkingLevel` exported (models.d.ts:10-11).

pi-coding-agent:

- ModelRegistry: getAvailable (:56), find(provider, modelId) (:60), refresh (:34), getApiKeyAndHeaders → `{ok:true, apiKey?, headers?} | {ok:false, error}` (model-registry.d.ts:7-14, :71). No env field at 0.74.0.
- ctx.ui: select/confirm/input/notify/setWidget/custom<T> (types.d.ts:67-191, custom at :116). ctx.hasUI (types.d.ts:211).
- VERSION exported (config.d.ts:65, index.d.ts:1). getSelectListTheme exported (index.d.ts:24).

pi-tui:

- SelectList ctor `(items, maxVisible, theme, layout?)`; setFilter/setSelectedIndex/getSelectedItem/handleInput; NO item-replacement method — new instance to change items (select-list.d.ts:26-49).
- Input: `getValue()` METHOD (not property), setValue, onSubmit, onEscape, focused (input.d.ts).
- Container exported from tui.d.ts:123 (bare layout; distinct from Box in components/box.d.ts).
- Text ctor `(text?, paddingX?, paddingY?, customBgFn?)`, setText (text.d.ts:5-18).

## DIFFERS vs plan/spec claims (all anticipated by M0 verification against 0.80.10)

1. Prompt says 50 words, enforced default is 100 (plan deletes old prompt; new prompt interpolates wordLimit — resolved by design).
2. Today's generation path is `complete`, not `completeSimple` — migration is a real change (intended).
3. No `max` thinking level at 0.74.0; spec says 0.80.10 adds it — M0 must confirm.
4. Container vs Box are distinct pi-tui primitives.
5. SelectList cannot replace items in place at 0.74.0 — rebuild instance on draft change (plan anticipated; M0 re-verifies at 0.80.10).
