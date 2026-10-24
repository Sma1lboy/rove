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

## 2026-10-11 — switch.perOp.commit.root / .workspace (main 23c1cf9)

**No regression.** Run 1 read boot.firstFrame.ms 1277.8 and boot.ready.ms 4437 (cold first run again); run 2 was clean, with typing.perOp.frame 2.07 → 1 as the only change past tolerance (✓, #1220). **Baseline moved** to run 2's metrics. Counters that did not tick are kept as explicit zeros.

**Where a switch's host renders come from.** A temporary per-render identity check on `WorkspaceRoot`'s hook values (cheap, it does not walk the fiber tree) shows 3 host renders per switch: (1) `selectedId`; (2) about 10 ms later, a `kv` identity change from `writeInboxVisit` ("inboxVisits"), called from `TerminalTabs`' `[state.activeId]` effect via `onTabVisited` → `resolveVisited`. `notif` changes identity in the same render. (3) The daemon's `tasks`/`activeTaskId` echo of `setActiveTask`. The other ~6 root commits per switch happen below the host (the terminal mount waterfall, see 10-05).

**Approach.** Write the visit synchronously in `selectTask` (a new `onSelected` callback on `useWorkspaceSelection`, using `activeTabIdFor(id)`), so it batches with `setSelectedId`. The effect's later write then hits the "already on top" skip.

**Why it did not count.** At the host level it batched: `kv` and `selectedId` changed in the same render. But switch.perOp.commit.root went 9.5 → 10.7 on 2 of 2 runs, with workspace 9.0 → 9.6/9.8, files 4.5 → 5.9/6.0 and sidebar 3.3 → 3.8. The effect-time KV write was evidently already folded into a commit that happens anyway, likely the terminal waterfall. Moving the KV rebuild into the selection commit makes every KV consumer render there, and that commit seems to split the work that follows. The design also had a flaw: callers that run `selectTask(id)` and then `requestTabActivation(id, tab)` (inbox `openItem`/`openTask`) would record a visit for the old tab. Not kept.

**Lesson:** an extra host render is not always an extra commit. Count commits on a clean run before moving a state write earlier.

**Still open:** every `kv.set` rebuilds the KV context, so all `useKV` consumers re-render, `notif` included. `kv-core.set` also makes a new snapshot when the value is unchanged (`Object.is`). That does not matter for `inboxVisits`, which always changes on an A↔B switch.

## 2026-10-12 — notes (main b33df5e)

**No regression.** Run 1 read boot.firstFrame.ms 1492 / boot.ready.ms 5688 (cold first run again). Run 2 flagged only golden.vt-1mb-parse-ms 92.2 → 138.8. `perf:golden --fast` alternated on 23c1cf9 (last night's main) and b33df5e read 120/129.6/143.2/145.5 vs 182.3/152.7/162.6/153.5. The ranges overlap, and the 4 commits since then touch only sidebar menu/i18n code (no VT, no lockfile), so this is machine noise. Baseline not moved.

**Per-switch commit anatomy (clean, cheap trace: a host-hook identity diff plus a Profiler `onRender` log to a file; counts matched an untraced run).** About 10 root commits per switch: (1) `selectedId`, a full tree render of about 7 ms; (2) a nested update in the same pass, which also carried the `inboxVisits` KV write (`kv`, `notif` and `inbox.availableItems` identities changed, so the host re-rendered); (3) workspace nested-update with 0 ms; (4) the daemon's `tasks`/`activeTaskId` echo, a full render; (5–10) the terminal mount waterfall, in workspace only. Pane focus does not flip during perf switches: the row click keeps workspace focus.

**Landed tonight as PR #1237 (`perf/nightly-2026-10-12`):** `writeInboxVisit` uses a new `kv.setQuiet` (persist and `get`, no snapshot notify). Only the Inbox dialog reads the log, when it opens. switch.perOp.stateNotify 4.4 → 3.4/3.7/3.6, stateListener 6.4 → 5.4–5.9, host renders per switch 3 → 2, and commit (2)'s root time 5.75 → 2.36 ms. **Commit counts did not drop:** commit (2) still happens without the KV write, because sidebar and files run their own nested update right after a selection. Find that setState next (likely the sidebar cursor following `selectedId` and the Files pane's `worktreePath` effect; see 10-06 before touching the latter).

**Unmemoized hook returns:** `sidebarWidth`, `pages` and `banner` change identity on every host render. That is harmless unless they reach a memoized child, but check this before trying `React.memo` on panes.

## 2026-10-13 — notes (main cc3c2e5)

**No regression.** Run 1 read boot.firstFrame.ms 1047 / boot.ready.ms 3671 and golden.cli-startup-ms 73.1 / vt-1mb-parse-ms 182.1 (cold first run plus machine noise again); run 2 was clean. #1237 landed: switch.perOp.stateNotify 4.5 → 3.3–3.7, stateListener 6.7 → 5.3–5.9, a drop below tolerance in run 2, so the baseline was not moved.

**Tracer that does not perturb batching:** wrap the React dispatcher (`__CLIENT_INTERNALS_…`.H setter; a proxy whose `useState`/`useReducer` return a WeakMap-cached wrapped setter that logs a short stack), plus a Profiler `onRender` log with phase. Counts matched an untraced run. It names the exact setState line behind each commit.

**Landed tonight as a PR from `perf/nightly-2026-10-13`:** commit (2) per switch, the nested update, gets its sidebar part from `SidebarTree`'s follow effect: the click sets the cursor to the worktree row, then the effect moves it to the active tab row. The active-row edge is now followed during render. switch.perOp.commit.sidebar 3.3 → 2.2 / 2.1; root/workspace/files unchanged (the nested commit still happens).

**What else is in that nested commit** (all passive effects after the selection commit): `use-terminal-pty.ts` 101–106/147 (acquire), `Terminal.tsx:294`, `TerminalSplit.tsx:105`, `title-subscriptions.ts:130`, `use-turn-polls.ts` 78/88/166, `notifications.tsx:103` via `TerminalTabs.tsx:248`, and the FileTree wipe `FileTree.tsx` 155–161 + 119. Removing the commit needs all of them gone; see 10-05 and 10-06 before touching terminal or FileTree.

## 2026-10-14 — notes (main 5f277b5)

**No regression.** Run 1 flagged only golden.cli-startup-ms 46.2 → 81.7 (machine noise, as on 10-07/10-08/10-13); run 2 was clean. #1251 landed: switch.perOp.commit.sidebar 3.3 → 2.3–2.6, a drop of 1 at most, so it is not past tolerance and the baseline was not moved.

**Where the Files pane's renders come from (temporary per-render state/prop diff in `FileTree`, written to a file; it does not walk the fiber tree).** On main, one perf run gave 71 FileTree renders. 25 changed only the five callback props, because the host passed inline lambdas and the unstable `editor.*`/`toggleZen`. 16 changed nothing: a context of `HostFilesPane`/`FileTree`, or a parent render with the same props. 13 were `worktreePath` and 11 were the wipe effect's `allFiles,expandedDirs`.

**Landed tonight as a PR from `perf/nightly-2026-10-14`:** `HostFilesPane` is `memo`'d, its callbacks come through `useFilesPaneActions` (stable wrappers over `useLatest`), and its `RenderProfiler` moved inside the memo boundary. A Profiler that is a child of a re-rendering host always ticks, even when everything below it bails out. switch.perOp.commit.files 4.7 → 3.0 (3 of 3 runs), FileTree renders per run 71 → 43, root/workspace unchanged.

**Left in Files per switch:** `worktreePath` (1), the wipe effect (1), plus about 1 empty render (a context). The 10-06 note covers the wipe.

## 2026-10-15 — switch.perOp.commit.root / .workspace (main 377ec26)

**No regression.** Run 1 read boot.firstFrame.ms 1074.7, boot.ready.ms 4261 and golden.cli-startup-ms 97.1 (cold first run plus machine noise again). Run 2 changed only switch.perOp.commit.sidebar 3.3 → 2.1 and stateListener 6.7 → 5.6, both ✓ (#1237 and #1251). **Baseline moved** to run 2, with the three untouched typing counters kept as explicit zeros. #1255 (Files pane memo, 10-14) is still open, so Files was left alone tonight.

**Tracer fix.** The 10-13 dispatcher proxy has to skip values that are already proxies. React saves `H` and restores it, so the setter receives the proxy back. Without the skip it nests a new proxy on every restore, and each setState is logged N times (it read 12 `setCursor` per key). Keep a `WeakSet` of proxies. A Profiler `onRender` line written into the same file (phase plus actualDuration) shows which setState batch became which commit. Wrapping `useSyncExternalStore`'s subscribe callback shows store notifies.

**Per-switch commit anatomy (clean trace, root 9.0–9.6, untraced 9.5).** (1) click selection, about 4 ms; (2) nested: the big passive-effect pass, see 10-13; (3) nested, **0.00 ms**; (4) the daemon echo (`remote-orchestrator-events.ts:108/128` notifies), about 2.5 ms; (5) nested, 0.00–0.09 ms; (6) `geomTick` from the body's layout `onResize` (`use-terminal-geometry.ts:41`); (7) the geometry effect (`setBodyRows`/`setBodyGeometry`); (8) acquire `setPty`; (9) the `[pty]` effect prime plus the first publish. Commits 6–9 are one chain, because each remounted Terminal measures its body from scratch before it acquires.

**Typing:** exactly one publish → `setSnapshot`/`setCursor` → commit per key. That is the paint path (React state → painter, `flushSync` in the frame scheduler), so typing.perOp.commit.root = 1 is the floor without a terminal rewrite.

**Approach.** Commit (3) followed `keyboard-hints.tsx:84` (`useStatusKeyHintItems`' effect) calling `setSnapshot(prev => … ? prev : next)` twice. That effect re-runs because about 12 `bumpStackVersion` calls per switch come from `useBindings` mount and unmount in the remounted terminal tree. The change compared the snapshot against a ref and skipped `setSnapshot` when nothing changed.

**Why it did not count.** The hint calls disappeared from the trace, but the 0.00 commit (3) stayed, so it has a second source that the setState, external-store and mismatch traces don't show. Clean runs read root 10.0 and 10.3, workspace 9.3 and 9.4 (baseline 9.5 / 9.1): no drop. Not kept.

**Next candidates.** (a) Find commit (3)'s real source. A setState from a layout effect, a ref callback or a class component is not traced. Try also wrapping `useLayoutEffect`/`useInsertionEffect` bodies, or log `scheduleUpdateOnFiber` from a patched reconciler copy. (b) Fold commits 6–7: seed the first geometry measurement from the outgoing Terminal's last body size when the layout key is unchanged. Read `use-terminal-geometry.ts`'s header (inline ref, 0x0 first attach) and 10-05 first. (c) Reduce `bumpStackVersion` churn (one bump per effect flush instead of per registration).

## 2026-10-16 — notes (main 0c4d57a)

**No regression.** Run 1 was clean on every count. Timings moved within tolerance (boot.firstFrame.ms 935). Over the three main runs tonight, root read 9.7/9.9/10.0 and workspace 9.3/9.3/9.3. The baseline was not moved. #1255 (Files memo) is still open, so Files was left alone.

**Landed tonight as a PR from `perf/nightly-2026-10-16`:** candidate (b) from 10-15, in a simpler form. `bumpGeomTick` (the body box's `onSizeChange`) now measures `bodyEl` itself, through a ref mirrored by `setBodyEl`, so `geomTick` and `bodyRows`/`bodyGeometry` land in one batch. The passive effect still measures on attach and on `dims`, and its re-run after the tick sets equal values and bails. This folds commits 6–7 of the 10-15 anatomy. switch.perOp.commit.workspace 9.3 → 8.3/8.7/8.4/8.3 and root 9.7–10.0 → 8.8/9.4/8.8/8.8 over 4 runs. Frame, spawns and timings are unchanged.

**Pre-existing on main (unchanged):** the render tests "the Clone tab's parent dir walks the same way" and "a multi-line paste is delivered as one paste" still fail. Run 1 of the change flagged golden.cli-startup-ms 69.6 (machine noise, as on earlier nights).

**Sandbox:** the harness Playwright asks for headless shell rev 1228 at `chrome-headless-shell-linux64/`; the root asks for 1194 at `chrome-linux/`. The shim needs both.

**Next:** the acquire `setPty` commit (8) still follows the measuring commit. Folding it would mean acquiring in a layout effect or in the measure callback itself. Read the `use-terminal-geometry.ts` header first: the PTY must boot at its real size.

## 2026-10-17 — switch.perOp.commit.root / .workspace (main eb06f85)

**No regression.** Run 1 was clean; the only changes past tolerance were ✓: switch.perOp.commit.files 4.8 → 3 (#1255 landed) and golden.vt-1mb-parse-ms 126.1 → 58.1. **Baseline moved** to run 1, with the four never-ticking typing counters as explicit zeros and vt-1mb-parse kept at 126.1: it has read 92–233 on this sandbox across nights, and a 58 baseline would flag noise every night. #1284 (geomTick fold, 10-16) is still open, so terminal geometry was left alone.

**Approach.** Candidate (c) from 10-15, as a subscription instead of a coalesced bump. `useStatusKeyHintItems` stopped reading `useBindingStackVersion()` (a `useSyncExternalStore`, so every `bumpStackVersion` re-rendered the footer, about 12 per switch). Its effect instead subscribes to the stack through a new `subscribeBindingStack` and re-runs the compare-and-set `setSnapshot`, so the footer renders only when the hint tokens change. Typecheck and the three status-hint render tests passed.

**Why it did not count.** Two clean runs read root 9.6/9.3, workspace 9.4/9.2, frame 4.2/3.7 against 9.5/9.5/4.2 on main tonight: noise. The footer's store-driven renders were already batched into commits that happen anyway (the passive-effect flush), so commit (3)/(5)'s 0.00 ms source is not the footer's store subscription either. The diff is small to redo (keymap.ts `subscribeBindingStack`, keyboard-hints.tsx effect) if a later change needs footer renders down for its own reasons.

**Next:** for commit (3), the setState, external-store and footer-subscription traces are now all ruled out; try logging `scheduleUpdateOnFiber` from a patched reconciler copy (10-15 candidate (a)).

## 2026-10-18 — notes, no attempt landed (main 2bbe18a)

**No regression.** All three runs exited 1 on timings only, and every count stayed within tolerance (switch.perOp.commit.root 9.8, workspace 9.8, sidebar 2.8, files 3, idle all 0). The timings swung run to run: golden.vt-1mb-parse-ms read 684.6, 460.9 and 1624.6 (baseline 126.1), and boot.ready.ms read 46598, 25616 and 15296. `perf-golden --fast` alternated between eb06f85 (last night's main) and 2bbe18a read vt-1mb 548.8/446.1 vs 726.4/112.8 and cli-startup 231–386 for both. That is machine noise, not code: the only commits since then are #1287 (routine DST) and #1288 (sidebar re-run checks). Baseline not moved. Tonight's history line is run 3.

**Sandbox:** the shell exports `BUN_OPTIONS=--smol`. Run 3 was taken with it unset. Check whether earlier nights had it set before comparing nights. Fixture `pty-host` processes also outlived teardown (two were left running after runs 1 and 2) and were killed before run 3.

**Tried, not done:** candidate (a) from 10-15 (log `scheduleUpdateOnFiber` from a patched react-reconciler in `node_modules/.bun/react-reconciler@0.33.0…/cjs`). The sandbox permission policy blocks editing `node_modules`. Next time, copy the reconciler into a scratch dir and point the import at it through a bun `--preload` plugin, or ask the owner. #1284 (geomTick fold) is still open, so terminal geometry was left alone. The `git ls-files` per switch is still blocked by the 09-28 invalidation problem (`--others` lists untracked files, so the index mtime is not enough).

## 2026-10-19 — notes (main 8c67638)

**No regression.** Run 1 exited 0, every count within tolerance (root 9.1, workspace 9.1, files 3, frame 3.6, spawns 1.5, idle 0). Taken with `BUN_OPTIONS` unset. Baseline not moved.

**Landed tonight as a PR from `perf/nightly-2026-10-19`:** the 09-28 per-switch `git ls-files`, unblocked with the fs watch as the invalidation signal. `file-list-cache.ts` keeps each LRU entry's recursive watch alive (one shared watch per path via `subscribeWorktreeEvents` in `pane-core.ts`, so the shown worktree is not watched twice). A list fetched once that watch has been armed ≥1 s (FSEvents arms async), with no event while the fetch ran or since, is fresh; the worktree-change effect then seeds it and skips the refetch. Remote worktrees and `ROVE_FILETREE_WATCH=0` are never fresh. switch.perOp.spawns 1.5 → 0.7 (2 of 2 runs; `ls-files` per run 12 → 4), commits/frames/timings unchanged. The remaining 0.7 is ~0.5 `ps -A` (2 s foregroundWalk) plus the first two re-lists before each watch settles.

**Blind spots it shares with the pane's existing watch:** `.git/` and `node_modules/` events are filtered, so an index-only change (`git rm --cached`, `git add -f` of an ignored file) leaves a fresh list stale until an event or `r`.

**Update 2026-10-19 (owner commit fc7f1d3 on the PR):** the skip was reverted. Owner's ruling: worktree fs events cannot prove a listing fresh, because `git ls-files --cached --others --exclude-standard` also depends on the git index and on exclude sources outside the worktree (`.git/info/exclude`, `core.excludesFile`, a linked worktree's common git dir). Switching back now always re-lists, and real-Git switch-back regressions pin index and exclude changes for main and linked worktrees. **Do not retry fs-watch freshness for `ls-files`.** Any future skip needs a signal that covers the index and every exclude source (e.g. index + exclude file mtimes plus the watch), and must pass those regressions.

**Closed 2026-10-19:** the owner closed #1291 unmerged. With the skip gone, the shared-watcher refactor alone was not worth +138 lines without a measured gain. Owner direction for a retry: keep the cache and invalidate it on index/exclude changes, rather than dropping the cache. Don't open a refactor-only PR without a measured gain.

## 2026-10-20 — switch.perOp.commit.root / .workspace (main 628a582)

**No regression.** Both main runs exited 1 on timings only (golden.cli-startup-ms 87.2/76.8, switch.shown.p50.ms 552/486, typing.echo.p50.ms 170/172; run 1 also boot.* cold). One `perf:measure` of 8c67638 (last night's main) on this machine read switch.shown 651, typing.echo 201 and cli-startup 71.4, and `perf:golden --fast` alternated between the two read cli-startup 64–79 vs 68–82. Machine noise, not code. The counts improved: switch.perOp.commit.files 3 → 0 (#1294 makes zen the default, so the Files pane is not mounted in the fixture), root/workspace 9.5 → 8.2/8.3 (#1284 geomTick fold landed). The baseline was not moved because the run also had ✗ timings. **Note for later nights:** with zen the default, commit.files now reads 0, and the baseline's 3 will show ✓ until it moves.

**Sandbox:** the harness Playwright now asks for headless shell rev 1228 at `chrome-headless-shell-linux64/` (as on 10-16); the root asks for 1194. The shim needs both, and the 1228 dir needs an `INSTALLATION_COMPLETE` marker. `BUN_OPTIONS=--smol` was exported again; every run tonight unset it. `pkill -f pty-host` inside a compound command kills its own shell (exit 144), so run it on its own.

**Approach.** Fold commit (9) of the 10-15 anatomy (the `[pty]` effect prime) into the acquire commit (8). The acquire effect in `use-terminal-pty.ts` called a shared `prime(handle)` (capture/captureWindow/captureWrapped/captureCursor) in the same batch as `setPty`. The `[pty]` effect's re-prime and `onData`'s immediate callback then set the same cached identities (`XtermTaskPty.capture()` returns `this.snapshot`) and bail. Lint, typecheck and the terminal render tests passed.

**Why it did not count.** Two runs read root 8.2/8.1 and workspace 8.2/8.1 against 8.3/8.2 on main tonight, with frames 4.0/4.0 vs 4.3/3.9 and paintRow 47 throughout: noise. So on a switch back to a live hosted PTY the prime was not a commit of its own. It was probably already batched with the `[pty]` effect's `setExited` and `onData` callback in the passive flush that follows commit 8, or it bailed. Not kept.

**Lesson:** the commits after the measure commit are not simply one setState each. Before folding the next one (the `setPty` acquire commit itself), trace it with the 10-15 dispatcher proxy.

## 2026-10-21 — notes (main 79a8f9f)

**No regression.** All three main runs exited 1 on golden.cli-startup-ms only (57.6/54.1, baseline 35.5, the series minimum). A direct A/B of `bun src/cli/rove.ts --version` between 628a582 (last night's main) and 79a8f9f read 43–61 vs 43–70 ms. Machine noise. Every count stayed within tolerance or improved (commit.root/workspace 8.2, files 0, spawns 0.5). The baseline was not moved because the runs also had a ✗ timing. Tonight's history line is main run 2.

**Landed tonight as PR #1325 (`perf/nightly-2026-10-21`):** the switch/typing spawns were all `engine.foregroundWalk`. The TUI's live-engine store ran `ps -A` every 2 s while any PTY existed. On Linux it now uses `descendantSnapshot` (`src/engine/proc-descendants.ts`), which walks only the anchors' subtrees via `/proc/<pid>/task/*/children` and `cmdline`. It falls back to `ps` off Linux, without CONFIG_PROC_CHILDREN, or on any read error. switch.perOp.spawns 0.5 → 0.1 and typing.perOp.spawns 0.2 → 0 (3 of 3 runs). The 0.1 left is a one-off daemon `ps`. Commits and frames are unchanged. typing.echo read 149–152 against main's 143–148, inside tolerance. The rows hold descendants only, so the change must never reach ancestry callers (`hasAncestor`).

**Sandbox:** pre-pr has 10 failures here that are pre-existing on main. Nine are unit tests in `worktree-remove-partial`, `land` and `layout-migration`, which fail because the sandbox runs as root. The tenth is behavior `pure-tui-live-tab-title`, where the PTY host never sees the OSC title. In vitest (Node), `Bun.spawn` is undefined, so tests that call `psSnapshot` directly fail; use `execFileSync("ps")`. `BUN_OPTIONS=--smol` was exported again and unset for every run.

## 2026-10-22 — regression, fixed (main f0b0fcb)

**Regression, reproduced twice:** switch.perOp.stateListener 5.7 → 10.0/10.3 (✗), with commit.root 8.2 → 10.3, workspace 8.2 → 9.3, sidebar 2.2 → 3.3 (inside tolerance). golden.cli-startup-ms also flagged (57/70.5), the usual machine noise. **Bisected** over 50 commits from 79a8f9f: fe35a61 good (5.9), 74650eb bad (10.0) — #1353, daemon-owned tabs.

**Cause:** every `TerminalTabs` mount calls `ensureTabReservation` and every unmount `releaseTabReservation`, so each switch re-reserves. The `tabs.reserve` reply calls `publish(taskId)`, which builds a new `TabsState` object (same `tabs` array, activeId, nextOrdinal) and bumps `tabsRevision`, waking its five readers (TerminalTabs, sidebar `useTabsByTask`, inbox pane, inbox host, show-workspace) and costing ~2 commits.

**Fix, PR #1384 (`perf/nightly-2026-10-22`):** `publish()` returns the shown state when `tabs`/`activeId`/`nextOrdinal`/`reopenAs` are identical. Two runs: stateListener 6.3/6.3, root 8.5/8.5, workspace 7.5/7.5 (below the pre-regression 8.3), sidebar 2.4/2.3; frames and timings unchanged. A `tabs-sync.test.ts` case pins it. No separate optimization tonight (regression night). Baseline not moved: the run had ✗ entries. Tonight's history line is main run 2.

**Sandbox:** the harness Playwright now asks for headless shell rev 1194 at `chrome-linux/` (same as the root); the 1228 shim was kept too. `BUN_OPTIONS=--smol` exported again and unset for every run. A leftover fixture `pty-host` survived run 1; killing it was blocked by the sandbox policy, and run 2 read the same counts anyway.

## 2026-10-23 — regression, fixed (main 10b6ad5)

**Regression, reproduced twice:** switch.perOp.frame 4.2 → 7.0/6.8, commit.root 9.5 → 11.1/10.8, sidebar 2.4 → 4.0/3.8, stateNotify 3.6 → 10.4/10.4, stateListener 5.8 → 11.5/10.6 (all ✗). golden.cli-startup-ms flagged too (81/72, usual noise). **Bisected** by direct measure: 437a8b4 good (frame 4, root 8, notify 3), 115f663 bad (6.8 / 10.8 / 8.4) — #1390, the daemon `state` channel.

**Cause:** each switch writes `lastActive.taskId` (orchestrator, `patchStateFile`) and `inboxVisits` (kv `setQuiet`). The daemon's state watcher pushes state.json back; `kv.follow` → `merge` saw both keys differ from the snapshot (quiet keys never live in the snapshot; lastActive is never written through kv) and called `store.set`, waking every kv subscriber: ~2.7 extra commits and frames per switch. Each push also notifies two raw `state` cells (main orchestrator subscribes to all channels, 0 listeners; UiPrefsSync, 1).

**Fix, PR #1400 (`perf/nightly-2026-10-23`):** the push omits `lastActive.taskId` (`isUnpublishedStateKey` in state-watcher.ts; follow keeps its local copy), and `follow` (not `reload`, whose test pins snapshot = file) absorbs flushed quiet keys into the quiet map without a snapshot change. Two runs: frame 4.3/4.1, root 8.4/8.1, workspace 7.4/7.1, sidebar 2.3/2.0, stateNotify 7.5/7.0, stateListener 9.4/8.0. Timings unchanged. No separate optimization (regression night). Baseline not moved.

**Left over (owner's call, not fixed):** stateNotify stays ~7 vs 3. ~2.4/switch is #1394's `MachineFeed.tasksAcc` forwarding every local `task.snapshot` (before, zero machines returned the local cell itself); ~2.5 is the raw `state` cell pair per `inboxVisits` push. Neither causes commits or frames. Folding the feed forward back means a derived ReadableState (subscribe to local + remote, memoized get).

**Sandbox:** harness Playwright asks for headless shell rev 1228 again (`chrome-headless-shell-linux64/` + `INSTALLATION_COMPLETE`); 1194 is a plain dir symlink. Render suite has 6–8 timing flakes on main under full load (toast/delete tests); they pass in isolation.

**Update 2026-10-23 (owner commit c621dba on #1400):** absorbing *every* flushed quiet value silently was wrong: an open Inbox reads `inboxVisits` while rendering, so a changed visit from another window must repaint it. The owner's fix keeps only identical echoes silent and notifies on any changed remote value (even one equal to the old snapshot). **Lesson:** `setQuiet` means "my own writes need no render", not "no render reads this key". Suppress echoes by value equality, never by key.

## 2026-10-24 — notes (main 10016c7)

**No regression.** Both main runs exited 1. golden.cli-startup-ms read 83.9/81.7, switch.shown 570/530 and typing.echo 175/162; run 1 also had cold boot.* timings. That is the usual machine noise. switch.perOp.stateNotify 7.3/7.0 and stateListener 9.1/8.0 also flagged, but those are the known leftover from 10-23, the same as #1400's post-fix 7.0–7.5 / 8.0–9.4. Counts otherwise held or improved: root 8.7/8.2, workspace 7.7/7.2, sidebar 2.4/2.1, frame 4.4/4.0, spawns 0.7/0.5, idle 0. No open `perf:` issues. Baseline not moved because of the ✗ entries. Tonight's history line is main run 2.

**Landed tonight as PR #1410 (`perf/nightly-2026-10-24`):** the first half of the 10-23 leftover. `MachineFeed.tasksSignal` is now a derived ReadableState: it subscribes to the local tasks cell and a `remoteTasksAcc` (null while no machine is registered), and the merge is memoized on (local, remote) identity. With zero machines it returns the local array itself. stateNotify 7.3/7.0 → 5/5, stateListener 9.1/8.0 → 6/6 (2 of 2 runs). Commits, frames and timings are unchanged; switch.shown read 426/483. What remains of stateNotify above the 3.6 baseline is the raw `state` cell pair per `inboxVisits` push (main orchestrator 0 listeners, UiPrefsSync 1). The 10-23 lesson applies there: suppress echoes by value, not by key.

**Sandbox:** harness Playwright asks for headless shell rev 1228 at `chrome-headless-shell-linux64/`. The sandbox now ships `chromium_headless_shell-1243` in that layout, so dir symlinks (1228, 1194 → 1243) were enough. `BUN_OPTIONS=--smol` was unset for every run.
