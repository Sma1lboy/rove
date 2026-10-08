# Failed optimization attempts

One entry per discarded attempt: date, target metric, approach, why it did not count.

## 2026-09-24 — idle.commit.root / idle.commit.sidebar / idle.frame (main 61fa570)

**Approach.** Stop the whole sidebar re-rendering every 2 s while idle. `SidebarTree`'s `setInterval(setBranchTick)` became `setInterval(pollRegistered)`: rows register their paths through a new `useRegisteredPoll` (`panes/sidebar/poll-registry.ts`) instead of effects keyed on `branchTick`. `branchTick` then bumps only when a background poller writes a changed value (a new `subscribeBackgroundPolls` in `tui/lib/background-poll.ts`). Tab rows showing a `Date.now()`-relative age label got their own shared 2 s clock (`useAgeClock`, same shape as `useSpinnerFrame`), because `activityAgeLabel` relied on the tick. Lint, typecheck, poller and `test/render/sidebar` tests all passed.

**Effect when it ran.** idle commits/frames went 10 → 0; switch.perOp.commit.sidebar 4 → 3.3; typing.perOp.commit.sidebar 0.37 → 0.07.

**Why it did not count.** `perf:measure` stopped completing reliably. It passed on main 4/4 tonight but on this change only 2/6 (1 of 2 even with the plain 2 s tick put back on top). The failure is a 45 s timeout in the typing phase. The perf-b shell shows a fresh `bash-5.2#` without the `PS1='B> '` set earlier, so the shell seems to have been respawned or replaced. The root cause was not found. Restoring the tick did not fix it, so the extra poll-landing re-renders or the registry timing are the suspects, or a latent race they expose around a new task's first tab. Note: `snapshotTabs` in `use-tabs-by-task.ts` does not depend on `tabsRevision`.

**Before retrying:** find out why perf-b's shell restarts (fixture daemon.log and pty-host log, kept past teardown). Don't retry the same diff blind.

**Update 2026-09-25.** The 09-24 typing-phase timeout was not caused by the attempt. It reproduces on unmodified main (4/9 runs passed). Root cause: `setPrompt` clicks the terminal and types right away, and the first key (`P`) can land on the sidebar before focus moves (`shift+p` pins the row). bash then runs `S1='A> '; clear`, and `waitForText` still passes on the echoed command. The fix is in PR #1133 (settle after the click, verify the prompt, retry). With that merged, the 09-24 poll-registry diff can be re-measured instead of being written off.

## 2026-09-27 — note, not a failed attempt (main 9e40475)

**Idle counts are 10 or 12 by window alignment, not by code.** The idle tick flushes one render-profile row every 2 s, and the idle window is `(start, end + 1000]`, 11 s long. So it catches 5 or 6 rows depending on phase. Main read 12, 12 and 10 tonight with no code change, and 09-23 read 12. A 10 → 12 "regression" on idle counts alone is this artefact. Re-measure before bisecting.

**Typing-phase timeout still hits unmodified main.** It failed 2 of 2 runs tonight. #1133 (harness settle and retry) is still unmerged, so tonight's numbers were taken with its `perf-measure.ts` applied locally.

**Landed tonight as PR #1144:** `useHostSessions` compared inside a `setState` updater. Returning `prev` still re-rendered the sidebar (commit plus frame) right after each branch tick. Idle commits/frames went 10–12 → 5.

## 2026-09-28 — notes (main 7effc65)

**Landed tonight as a PR from `perf/nightly-2026-09-28`:** the Files pane's `resolveBase` revalidated its cached base with `git rev-parse HEAD` on every task switch; a local worktree now reads HEAD from its git dir files. switch.perOp.spawns 2.6 → 1.6.

**Remaining per-switch spawn:** `git ls-files` from `listFiles` (the All tab wipes and re-lists on every worktree change). A per-worktree cache is not safe as-is: the fs watch only covers the shown worktree, so an away worktree's list can go stale. Needs an invalidation signal (e.g. `worktreeFingerprint` from kobe-daemon's worktree-probe, which misses untracked-file adds) before it is worth trying.

**Noise:** `golden.daemon-connect-replay-ms` read 32.1 once (7.9 baseline) and 9.5 on the re-run. `golden.mem-per-tab-mb` swings 4.8–9.6 across nights with no related change.

## 2026-10-04 — notes (main 02dddc8)

**Baseline moved:** switch.perOp.spawns 2.6 → 1.5 (the 09-28 Files-pane HEAD read landed); every other change within tolerance.

**Landed tonight as a PR from `perf/nightly-2026-10-04`:** a simpler take on the 09-24 idea. Rows poll from a shared clock store (`tui/lib/sidebar-poll-clock.ts`) instead of effects keyed on `branchTick`; `branchTick` bumps only on `subscribeBackgroundPolls` (a poller wrote a changed value). Age-label and row-token rows subscribe to the clock via `useClockTick`. idle commits/frames 6 → 0; typing.perOp.commit.sidebar 0.2 → 0. perf:measure completed 2/2 with it.

**Pre-existing on main:** `bun run lint` fails on `test/client/pty-child-probe.test.ts` formatting (fixed in the PR); render test "the Clone tab's parent dir walks the same way" fails on unmodified main.

## 2026-10-04 (second run) — notes (main 1bfc6c3)

**Baseline moved:** #1200 landed, so idle commits/frames went 6 → 0. Counters that never tick are left out of metrics.json, and `compare` read the absent side as "no data", so the drop showed with no ✓. The baseline now carries explicit zeros for those keys. The compare fix (absent phase counter = 0) is on `perf/nightly-2026-10-04-zero-counters`. The first run read boot.ready.ms 5328 (cold first run); the re-run read 2147.

**Landed tonight as a PR from `perf/nightly-2026-10-04b`:** the terminal body's inline ref callback (`Terminal.tsx`) re-attached on every render, and its `setBodyEl(null)` → `setBodyEl(el)` scheduled a second render after each one. It stays inline only until the first geometry measurement; after that it passes the stable setter. typing.perOp.commit.root/workspace 2 → 1; switch.perOp.commit.root 10.6 → 9.5. typing.echo.p50 read 142/148/150 on main and 158/153/142.5/152.5 with the change: overlapping, noise.

**Remaining:** the per-switch `git ls-files` (see 09-28). `engine.foregroundWalk` (`ps -A`) runs every 2 s while a terminal tab is shown, so it is the source of typing.perOp.spawns 0.2. It is not covered by idle (no tab is shown yet during the idle phase).

**Fixture:** after #1201 the visual fixture's PTY command repeats every `ROVE_*` variable twice (`e2e/visual-fixture.ts`). This is harmless, but it is leftover from the rename.

**Pre-existing on main:** render tests "the Clone tab's parent dir walks the same way" and "a multi-line paste is delivered as one paste, never as Enter" fail on unmodified main.

## 2026-10-05 — switch.perOp.commit.root / .workspace (main 2ce7dd3)

**Baseline moved:** #1202 (terminal ref) landed: switch.perOp.commit.root 10.6 → 9.2 and .workspace 10.6 → 8.8 (both ✓). The first run read boot.ready.ms 7323 (cold first run again); the re-run read 2869.

**Approach.** Fold the terminal pane's mount waterfall on each task switch. A temporary React DevTools-hook tracer (a `__REACT_DEVTOOLS_GLOBAL_HOOK__` installed before `@opentui/react` loads; it calls `injectIntoDevTools()` unconditionally) logged which hooks changed per commit. Per switch it showed about 9 commits, with the terminal ones in this order: bodyEl, then geomTick, then bodyRows/bodyGeometry, then `setPty`, then the `[pty]` effect's snapshot/cursor prime plus the paint grid's `setGrid`. The change did three things. It primed snapshot and cursor in the acquire effect, in the same commit as `setPty`. It created the `TerminalRowPainter` in the grid ref callback instead of from `grid` state. It skipped same-value `setExited` and `setCursor` calls in the `[pty]` effect, and same-value `setRecovery` calls, since `onRecovery` replays its current state on subscribe. Typecheck passed.

**Why it did not count.** With the tracer attached, the first switch went from 9 commits to 8 and workspace from 8.8 to 8.4. Without the tracer, two clean runs read root 9.1 and 9.2 and workspace 8.8 and 8.8: no drop. The tracer walks the whole fiber tree on every commit, so it slowed commits enough to split updates that React batches in a normal run. **Do not count commits with a per-commit tracer attached.** Check any tracer finding against a clean run before writing code. The diff is not kept. It is small to redo: `use-terminal-pty.ts` acquire effect, `use-terminal-paint.ts`, and `Terminal.tsx` recovery.

**Still seen in the trace, not tried:** two commits per switch that change no hook state. In them WorkspaceFrame, TerminalSession and StatusKeyHintBar re-render, which points to a context change (focus moving to the workspace). The Files pane also wipes its list and lists it again on every switch (`FileTree` list null → arr), the known `git ls-files` item from 09-28.

**Noise:** switch.shown.p50 read 496/545 on main and 456–483 with the change; boot.firstFrame.ms 670–918 across runs.

## 2026-10-06 — switch.perOp.commit.files / .root (main 7c50b64)

**No regression.** The first run read boot.firstFrame.ms 1304.5 and boot.ready.ms 5426 (cold first run again); the re-run read 570 and 2044, every metric within tolerance.

**Approach.** The Files pane (`FileTree.tsx`) wipes its state (`allFiles`, `changes`, cursor, expanded dirs, scope) in a `useEffect` keyed on `worktreePath`, so each switch commits once for the new path and again for the wipe. The change moved the wipe into render ("adjust state when a prop changes": a `shownPath` state compared during render), leaving the effect to refetch only.

**Why it did not count.** It went the wrong way. switch.perOp.commit.files read 5.9 and 6.2 (5.2 on main tonight and in the baseline); root 9.5/9.8 vs 9.2, frame 4.0/4.6 vs 4.0. Not investigated further. A guess: the effect's wipe was already batched into a commit that happens anyway (e.g. with the terminal's mount waterfall), and the render-phase reset makes the first commit render the empty pane and the list arrive as a separate commit. Check with a clean-run count of which commits touch `files` before retrying anything in this effect.

**Spawn breakdown per switch (unchanged):** 0.8 `git ls-files` (Files pane All tab, 09-28 item) plus about 0.5 `ps -A` from the 2 s `engine.foregroundWalk` that lands in the window. `resolveBase`'s `git symbolic-ref` / `rev-parse` run only on each worktree's first show.

## 2026-10-07 — notes (main c8f2cca)

**No regression.** Run 1 read boot.firstFrame.ms 1062 / boot.ready.ms 4675 (cold first run again); run 2 flagged golden.cli-startup-ms 74.5 and golden.vt-1mb-parse-ms 183.2 (machine noise, different metrics each run); run 3 was clean.

**Landed tonight as a PR from `perf/nightly-2026-10-07`:** typing.perOp.frame 2.07 → 1. `terminalFrameScheduler` flushes PTY rows inside a frame callback, and every `requestRender` from that commit (React `resetAfterCommit`, the row painter's text updates) hit OpenTUI's `rendering` branch and set `immediateRerenderRequested`, so each write drew a second, identical frame. The flush now stubs `renderer.requestRender` for its duration. Layout and lifecycle passes run in `root.render` after frame callbacks, so the current frame is complete.

**Trap for render tests:** an auto-sized `<text>` that grows re-lays out during `root.render` and legitimately requests one more frame; a frame-count test needs a fixed-size text.

**Sandbox:** the harness pins a newer Playwright than the root (headless shell rev 1228, root 1194); the shim needs both revision dirs.

**Pre-existing on main:** `bun test test/render` is flaky on unmodified main (9 failures tonight, a different set per run besides the two known ones).

**Follow-up on PR #1220 (owner commit 4bf7a3c):** stubbing `requestRender` during the flush also swallowed the request of any refresh that re-schedules itself inside the batch (an open synchronized update defers its paint), so that frame never came. Fixed by calling `requestRender()` after restoring it when `pending` is non-empty. Lesson: when suppressing a side effect for a scope, check what inside that scope re-enters the same scheduler.

## 2026-10-08 — notes (main 22dffd7)

**No regression.** All three runs on main flagged timings only (boot.*, golden.cli-startup-ms, golden.vt-1mb-parse-ms, switch.shown.p50), a different set each run, with every count unchanged. golden on c8f2cca (last night's main) read the same on this machine: cli-startup 70.8–83.7, vt-1mb-parse 179–233 vs 105 in the baseline. The sandbox was slow tonight, so the code did not regress. Baseline not moved (typing.perOp.frame 2.07 → 1.07 is #1220, a drop of exactly 1, so it is not past tolerance).

**Landed tonight as a PR from `perf/nightly-2026-10-08`:** the Files pane starts a worktree's All list from its last listing (4-entry LRU, `tui/panes/filetree/file-list-cache.ts`) instead of null, so the unchanged `git ls-files` result no longer commits. switch.perOp.commit.files 5.2 → 4.7 / 4.5 (main 5.3 tonight); root unchanged (that commit was already batched with others). The spawn count does not change: the refetch still runs.

**Considered, not tried: gating the 2 s `ps -A` walk on PTY output.** An engine can't start or exit in a shell without output, so walks could be skipped while every probed PTY is quiet. Two blockers: subscribing to `onData` clears `unwatchedSince` and keeps hidden emulators refreshing (it defeats parking), and `setAuxPids` feeds every host session (`pty.list`) into the walk, which has no output signal. Local PTYs could use `lastOutputAtMs()`. For aux sessions, the host's `pty.list` would need a per-session output offset or timestamp first.
