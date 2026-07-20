# Run summary: 20260720-0003-spec-0-5-0

- Status: shipped
- Started: 2026-07-20T00:03:00Z — Finished: 2026-07-20T02:56:20Z (UTC)
- Source: docs/specs/spec_0_5_0.md with docs/agents/plan_0_5_0.md (both untracked at intake;
  snapshotted into the run folder)
- Base: main @ d1e9d8c; branch 20260720-0003-spec-0-5-0; PR targets main
- Diff (excluding run folder): 24 files, +5466 / −2072

## What shipped (pi-recap 0.5.0)

- Pi runtime baseline >= 0.80.10 (peer ranges, lockfile, load-safe runtime guard that
  degrades gracefully on old or version-less hosts).
- `src/config.ts` rewritten: global-only `piRecap` schema (recapModel, thinkingLevel,
  autoRecapEnabled, idleDelaySeconds, wordLimit, recentMessageLimit), deterministic per-field
  legacy migration (`intervalSeconds`, `provider`/`model`; `effort` never read), normalized
  atomic saves (unique tmp file, cleanup on failure), bounded 15s registry-refresh helper
  with hang and rejection degradation.
- `src/commands.ts` (new): canonical `/recap` grammar, first-slash model parsing, usage
  strings, legacy-head rejection with migration hints.
- `src/generate.ts` (new): spec's revised prompt (dynamic word limit), output sanitization
  (full ANSI/C0/C1/Unicode-separator handling), sentence-aware trimming, shared preflight
  gates with model-aware thinking clamp (side-effect-free preflight; stale-guarded persist),
  generation through `completeSimple` from `@earendil-works/pi-ai/compat` with `reasoning`
  omitted for `off`, 60s timeout, 2 retries.
- `src/settings-menu.ts` (new): staged 7-row TUI settings menu (draft-only until Save,
  ordered Save flow saveConfig → onSaved → close, searchable model selector from
  `getAvailable()` only, model-aware thinking choices, presets + validated custom input),
  headlessly drivable controller.
- `src/index.ts` rewritten: version guard with dynamic post-guard module loading, four
  triggers through one generation path, timer caching with inactivity semantics, full
  command dispatch incl. C7 (typed thinking with unresolvable model persists + warns),
  `--recap-*` flags and startup warning removed, unhandled-rejection guards, C8 test seams.
- Ten assertion-based bun suites incl. behavioral harnesses for the menu controller and the
  wired extension (deferred-completion concurrency, shutdown teardown, guard-path tests);
  `pnpm test` chains them fail-fast. README/AGENTS.md updated with breaking-changes section;
  version 0.5.0. Docs committed per human decision: CONTEXT.md, docs/specs/, docs/adr/.

## Review policy

- plan_review_tier: medium → plan-critique cap 2; both rounds run; stop: cap reached,
  round-2 accepted edits applied without re-critique.
- run_complexity: medium (confirmed after implementation; no aggregate-risk escalation) →
  code-review cap 2, adversarial QA skipped by policy.
- Code review: 2 rounds, both lenses (Claude Fable high + Codex GPT-5.6-Sol high) completed
  each round. R1: 12 findings, all accepted, fixed in c288b74, verified. R2: 5 deduped
  findings (both lenses confirmed all R1 fixes correct), all accepted, fixed in d4436de,
  verified via the full gate. Stop: cap reached — the round-2 fix wave was verified but NOT
  re-reviewed.
- Adversarial QA: skipped, reason: run complexity policy (medium).

## Acceptance criteria evidence

All gates green at HEAD: `pnpm check && pnpm lint && pnpm format:check && pnpm test`
(coordinator-verified after every wave and after each fix wave).

- AC-1 configure without JSON: menu controller traverses all 7 rows (test-menu); `/recap
settings` dispatch + non-TUI notice + typed setters (test-index).
- AC-2 defaults null/low: test-config.
- AC-3 null-model matrix: manual warns, no widget/model call; auto/startup/compaction silent;
  startup warning removed (test-gates, test-index).
- AC-4 no Pi model/thinking writes: named inspection lines in task 03/04 reports; zero
  `ModelSelectorComponent`/`registerFlag` greps.
- AC-5 effective level through Pi mapping: reasoning presence/absence + `defaultCompletion`
  identity (test-gates).
- AC-6 no silently effective unsupported level: clamps at menu Save, typed setters,
  generation time (self-quiescing, stale-guarded persist + notify) — test-menu, test-index.
- AC-7 staged menu semantics: Escape-discard, submenu Escape, Save order, rejected Save —
  test-menu controller layer.
- AC-8 delay survives auto toggle: test-config (schema), test-index (runtime caches/timer).
- AC-9 intervalSeconds inference: truth tables incl. partial migration (test-config).
- AC-10 project settings ignored: fake-source test where project values must have no effect.
- AC-11 prompt contract + max length: full-string prompt comparison (test-prompt),
  sentence-aware trim (test-trim), oversized-completion-trimmed-in-widget (test-index).
- AC-12 bare /recap + typed subcommands: test-index (incl. refresh with auto disabled),
  test-commands.
- AC-13 baseline: resolved versions of all three packages asserted; guard path tested with
  injected old/non-string versions.
- AC-14 flags/legacy removed: zero registerFlag (inspection), legacy heads → unknown with
  hints (test-commands, test-index).
- AC-15 assertion-based suites + full gate: test-extract converted; `pnpm test` fail-fast
  proven by forced failure.
- AC-16 retained behaviors: shared generation path, inactivity reset + full-delay
  requirement, previous recap kept on failure/empty response, empty-conversation feedback
  (manual/startup/compaction; auto silent), widget-above-editor placement (inspection +
  harness assertion).

## Not verified (recorded, per the settled human decision)

- Interactive TUI walkthrough of `/recap settings` in a live `pi` session: not performed
  (requires a real terminal session with the user's settings and potentially paid model
  calls). Covered instead by the headless controller tests driving real pi-tui components.
- `pi -p "hi"` smoke: not performed for the same reason (would read the user's real
  `~/.pi/agent/settings.json`). The harness routes all settings I/O to temp dirs.
- The round-2 review fix wave (d4436de) was verified by the full gate but not re-reviewed
  (cap rule).

## Decisions and judgment calls

- Docs in PR (human decision at understanding check): CONTEXT.md + docs/specs + docs/adr
  committed; docs/agents stays gitignored.
- Plan revision r1: merged original tasks 01+02 (thin serial seam); rejected splitting the
  index rewrite (would recreate the same seam) — landing risk addressed via the test-index
  behavioral harness instead.
- C7 pinned: typed thinking with a configured-but-unresolvable model persists the valid
  level and warns; AC-6 preserved by preflight/Save clamps.
- Review triage S6 narrowed: kept spec-required clamp persistence; rejected in-memory-only
  alternative. S8 adjusted: empty-conversation notice extended to startup/compaction (spec's
  unqualified retained-behavior bullet beats the source plan's manual-only decision); auto
  stays silent. S5: abort-on-input/shutdown-abort logged, not fixed (risk of cancelling
  legitimate runs; inherited posture).
- run_complexity held at medium post-implementation: no security/data/concurrency
  primitives; strong new observability; failure impact limited to a dev-tool widget.

## Incidents

- Codex worker sandboxes: Codex's inner seatbelt cannot nest inside the outer nono sandbox —
  first critic terminal failed all local reads (fell back to GitHub fetches, self-reported
  failed dispatch). Rebooted with `--sandbox danger-full-access` (nono remains the
  confinement). Second form: nono per-terminal grants cover only the cwd worktree, so the
  first task-01 builder could not read/write the run folder; all later Codex workers boot via
  `nono run --profile my-codex --allow-cwd --allow <RUNDIR> -- codex ...`. Both dispatches
  superseded and re-run; no work lost.
- Safe-chain blocked the fresh 0.80.10 install in the integration worktree; resolved with
  `--safe-chain-skip-minimum-package-age` (as planned).
- C5 API verification found `ModelRegistry.refresh()` async at 0.80.10 (contracts C3/C4
  pinned sync); worker escalated correctly, coordinator re-pinned before wave 2; later
  hardened into the bounded-refresh helper.
- Codex CLI trust/update prompts on first boots handled by the coordinator; bun requires
  `bun run ./scripts/...` (with `./`) in these worktrees.

## Open questions

None blocking. Post-merge, `orca worktree rm` of the integration worktree is the human's
step.
