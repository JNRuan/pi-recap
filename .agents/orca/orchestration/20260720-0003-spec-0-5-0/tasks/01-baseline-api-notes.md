# Pi 0.80.10 baseline API notes

Recorded before feature implementation from the installed 0.80.10 declarations under this task's `node_modules/@earendil-works/` links. Runtime probes used Bun without a TTY.

## Package baseline

- **CONFIRMED-AS-SPEC**: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui` each resolve to version `0.80.10` from their installed `package.json`.

## Pi AI

- **CONFIRMED-AS-SPEC**: `completeSimple<TApi extends Api>(model, context, options?)` is exported from `@earendil-works/pi-ai/compat`. The root entrypoint does not declare this compatibility function. Sources: `node_modules/@earendil-works/pi-ai/dist/compat.d.ts:65`, `node_modules/@earendil-works/pi-ai/dist/index.d.ts:1`.
- **CONFIRMED-AS-SPEC**: `ThinkingLevel` is `"minimal" | "low" | "medium" | "high" | "xhigh" | "max"`; `ModelThinkingLevel` is `"off" | ThinkingLevel`. `max` exists. Source: `node_modules/@earendil-works/pi-ai/dist/types.d.ts:22`.
- **CONFIRMED-AS-SPEC**: `SimpleStreamOptions` extends `StreamOptions` and declares `reasoning?: ThinkingLevel`, so `off` is represented by omitting `reasoning`. It also declares optional `thinkingBudgets`. Source: `node_modules/@earendil-works/pi-ai/dist/types.d.ts:213`.
- **CONFIRMED-AS-SPEC**: the pi-ai root exports `getSupportedThinkingLevels<TApi extends Api>(model): ModelThinkingLevel[]` and `clampThinkingLevel<TApi extends Api>(model, level): ModelThinkingLevel`. Source: `node_modules/@earendil-works/pi-ai/dist/models.d.ts:171`.

## Coding-agent context and registry

- **CONFIRMED-AS-SPEC**: `getApiKeyAndHeaders(model)` returns `Promise<ResolvedRequestAuth>`. Success is `{ ok: true; apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> }`; failure is `{ ok: false; error: string }`. The 0.80.10 result does include `env`. Source: `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts:5`.
- **DIFFERS**: `ModelRegistry.refresh()` is `Promise<void>`, not the synchronous `void` method pinned in the later C3/C4 structural contracts. Later implementations must await refresh before synchronous `find()` or `getAvailable()` reads. This was escalated to the coordinator as `msg_37d99167df7b`. Source: `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts:22`.
- **CONFIRMED-AS-SPEC**: `ctx.ui.custom<T>` accepts a component factory receiving `(tui, theme, keybindings, done)` and optional `{ overlay?, overlayOptions? }`. The actual factory may also be async, and the options additionally support `onHandle`. Source: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:116`.
- **CONFIRMED-AS-SPEC**: `ctx.ui.select`, `confirm`, `input`, `notify`, and both `setWidget` overloads are present. `select`, `confirm`, and `input` accept `ExtensionUIDialogOptions` with `signal` and `timeout`. Source: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:67`.
- **CONFIRMED-AS-SPEC**: `ExtensionContext.hasUI` is a boolean. The context also exposes `mode: "tui" | "rpc" | "json" | "print"`. Source: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:208`.
- **CONFIRMED-AS-SPEC**: `getSelectListTheme(): SelectListTheme` and `VERSION` are exported from the pi-coding-agent root. A runtime import reported `VERSION === "0.80.10"`. Sources: `node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts:2`, `node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts:29`, `node_modules/@earendil-works/pi-coding-agent/dist/config.d.ts:69`, `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.d.ts:116`.

## Pi TUI components

- **CONFIRMED-AS-SPEC**: `SelectList` constructor is `(items: SelectItem[], maxVisible: number, theme: SelectListTheme, layout?: SelectListLayoutOptions)`. Public callbacks are `onSelect`, `onCancel`, and `onSelectionChange`; public methods include `setFilter`, `setSelectedIndex`, `invalidate`, `render`, `handleInput`, and `getSelectedItem`. Source: `node_modules/@earendil-works/pi-tui/dist/components/select-list.d.ts:26`.
- **CONFIRMED-AS-SPEC**: `SelectList` items cannot be replaced in place through its public API. Both `items` and `filteredItems` are private and there is no `setItems`; a changed list must be rebuilt. Source: `node_modules/@earendil-works/pi-tui/dist/components/select-list.d.ts:26`.
- **CONFIRMED-AS-SPEC**: `Input` is zero-argument constructible, reads its value through `getValue()`, writes through `setValue(value)`, and exposes `onSubmit` and `onEscape`. Source: `node_modules/@earendil-works/pi-tui/dist/components/input.d.ts:5`.
- **CONFIRMED-AS-SPEC**: `Container` is zero-argument constructible with public `children`, `addChild`, `removeChild`, `clear`, `invalidate`, and `render`. Source: `node_modules/@earendil-works/pi-tui/dist/tui.d.ts:129`.
- **CONFIRMED-AS-SPEC**: `Text` constructor is `(text?: string, paddingX?: number, paddingY?: number, customBgFn?)`; it exposes `setText`, `setCustomBgFn`, `invalidate`, and `render`. Source: `node_modules/@earendil-works/pi-tui/dist/components/text.d.ts:5`.

## Probes

- **CONFIRMED-AS-SPEC**: a Bun assertion probe with no TTY constructed and rendered both `SelectList` and `Input`. `SelectList` handled Down, Enter, filtering, and selection callbacks; `Input` handled text, Enter submission, Escape, and `getValue()`. Result: `PASS SelectList and Input construct, render, and handle selection/filter/text/submit/escape headlessly without a TTY`.
- **CONFIRMED-AS-SPEC**: `pnpm exec tsc --showConfig` reports root `include` values `src/**/*.ts` and `scripts/**/*.ts`. Its effective pre-feature file list is `src/config.ts`, `src/conversation.ts`, `src/index.ts`, and `scripts/test-extract.ts`, so root typechecking covers scripts.

## Contract impact

C1 and C2 are not contradicted by the installed Pi types. The asynchronous `ModelRegistry.refresh()` result contradicts only later C3/C4 assumptions, so task 01 can continue while the coordinator re-pins those contracts.
