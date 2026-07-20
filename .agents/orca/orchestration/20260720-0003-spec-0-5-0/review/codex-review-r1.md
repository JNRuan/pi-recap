## Tests review

Tests review: no additional code issues found.

## Code Issues

**Issue 1** - Cancelled preflight can overwrite newer user settings
**Severity**: Medium
**Confidence**: 98/100
**Category:** Data
**File:** `src/generate.ts:151`, `src/index.ts:300`
**Findings:**

- `runRecap()` snapshots the complete configuration before awaiting registry refresh and authentication. When capability validation clamps the thinking level, `preflightRecap()` writes that full stale snapshot before `runRecap()` checks whether activity invalidated the request.
- Concrete trigger: Auto Recap or resume/compaction preflight begins, then the user returns and runs `/recap auto off`, changes the model, or changes the delay while refresh or authentication is pending. The command saves the new configuration, but the older preflight can resume and restore every old field while changing only `thinkingLevel`.
- This can leave runtime and disk inconsistent. For example, `/recap auto off` updates the runtime closure to disabled, while the stale preflight restores `autoRecapEnabled: true` on disk, so Auto Recap returns after reload.

**Evidence:**

- The snapshot is loaded at `src/index.ts:300`; preflight is awaited at `src/index.ts:304`; cancellation is checked only afterward at `src/index.ts:313`.
- `preflightRecap()` awaits registry and auth work at `src/generate.ts:138` and `src/generate.ts:144`, then persists `{ ...config, thinkingLevel: effectiveLevel }` at `src/generate.ts:151`.
- Command handlers can run while detached startup, compaction, and timer preflights are pending, and they persist full current configurations through `persistConfig()` at `src/index.ts:264`.

**Fix:**

- Make preflight side-effect free: return the effective level and whether clamping is required.
- After the generation token and leaf checks pass, reload the latest configuration and persist the clamp only if its model and requested thinking level still match the preflight snapshot. Merge the level into that latest configuration so unrelated settings survive. Add a deferred-refresh regression test where a setter completes before the older preflight resumes.

**Issue 2** - Unbounded registry refresh can wedge recaps and settings
**Severity**: Medium
**Confidence**: 95/100
**Category:** Reliability
**File:** `src/generate.ts:138`, `src/settings-menu.ts:205`
**Findings:**

- Generation, typed model/thinking setters, menu construction, model submenu entry, and Save all await `registry.refresh()` without a timeout or cancellation path.
- A stalled remote model-catalog request leaves generation `pending` indefinitely, so every later manual or automatic recap returns at the pending guard. In the settings controller, serialized input waits behind the same refresh, so Escape cannot close the overlay.

**Evidence:**

- Generation sets `pending` around preflight at `src/index.ts:295` and `src/index.ts:358`; the awaited refresh is at `src/generate.ts:138`.
- Menu refreshes occur at `src/settings-menu.ts:205`, `src/settings-menu.ts:434`, and `src/settings-menu.ts:808`; controller input is serialized at `src/settings-menu.ts:307`.
- In the pinned Pi 0.80.10 implementation, `ModelRegistry.refresh()` delegates to a network-enabled runtime refresh without accepting an abort signal. Remote catalog `fetch()` receives no signal on this facade path. Pi's own model selector bounds the equivalent refresh with a 15-second abort and falls back to cached models.

**Fix:**

- Centralize registry refresh behind a bounded helper used by generation, typed setters, and menu paths. On timeout, release `pending` and either fail the generation gate or continue with the cached registry snapshot while warning the user.
- Prefer a Pi registry API that accepts an `AbortSignal` when available. Until then, ensure the local await is bounded and the settings overlay remains cancellable. Add never-resolving refresh tests for generation and the menu input queue.

## Documentation & Artifact Recommendations

**NO RECOMMENDATIONS.**

## Verdict

**Needs work**
