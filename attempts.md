# Failed optimization attempts

One entry per discarded attempt: date, target metric, approach, why it did not count.

## 2026-09-24 — idle.commit.root / idle.commit.sidebar / idle.frame (main 61fa570)

**Approach.** Stop the whole sidebar re-rendering every 2 s while idle. `SidebarTree`'s `setInterval(setBranchTick)` became `setInterval(pollRegistered)`: rows register their paths through a new `useRegisteredPoll` (`panes/sidebar/poll-registry.ts`) instead of effects keyed on `branchTick`. `branchTick` then bumps only when a background poller writes a changed value (a new `subscribeBackgroundPolls` in `tui/lib/background-poll.ts`). Tab rows showing a `Date.now()`-relative age label got their own shared 2 s clock (`useAgeClock`, same shape as `useSpinnerFrame`), because `activityAgeLabel` relied on the tick. Lint, typecheck, poller and `test/render/sidebar` tests all passed.

**Effect when it ran.** idle commits/frames went 10 → 0; switch.perOp.commit.sidebar 4 → 3.3; typing.perOp.commit.sidebar 0.37 → 0.07.

**Why it did not count.** `perf:measure` stopped completing reliably. It passed on main 4/4 tonight but on this change only 2/6 (1 of 2 even with the plain 2 s tick put back on top). The failure is a 45 s timeout in the typing phase. The perf-b shell shows a fresh `bash-5.2#` without the `PS1='B> '` set earlier, so the shell seems to have been respawned or replaced. The root cause was not found. Restoring the tick did not fix it, so the extra poll-landing re-renders or the registry timing are the suspects, or a latent race they expose around a new task's first tab. Note: `snapshotTabs` in `use-tabs-by-task.ts` does not depend on `tabsRevision`.

**Before retrying:** find out why perf-b's shell restarts (fixture daemon.log and pty-host log, kept past teardown). Don't retry the same diff blind.
