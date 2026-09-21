/**
 * What tabs each task has RIGHT NOW — the sidebar's tab projection.
 *
 * Its own module because it answers a different question from the row list:
 * this one is about PROCESSES (which pty sessions exist, what is running in
 * them, what they are called this second), while `use-tree-state.ts` is about
 * ROWS. Separating them is also what lets the folded rail have the answer: the
 * fold renders no tab rows, but "does this task have any tabs" is what decides
 * whether its project is on screen at all, so the projection has to sit ABOVE
 * the collapsed/expanded fork rather than inside the tree.
 *
 * Three sources merge here, in order of authority:
 *   1. the KV snapshot (`knownTaskTabs`) — answers for tasks whose
 *      `TerminalTabs` never mounted, which is every task after a restart;
 *   2. the live pty host inventory — titles and freeze-restored corpses for
 *      sessions this process never attached to;
 *   3. the orphan backstop — live sessions no snapshot claims, surfaced as
 *      rows and then adopted into the snapshot so they stop being orphans.
 */

import type { Task } from "@/types/task"
import { DEFAULT_TASK_VENDOR } from "@/types/task"
import { useEffect, useMemo, useState } from "react"
import type { TreeTab } from "../../../tui/panes/sidebar/tree-core"
import { tabRowId } from "../../../tui/panes/sidebar/tree-core"
import { isRecentlyClosedPtyKey } from "../../../tui/workspace/closed-tab-suppress"
import { getDefaultLiveEngines } from "../../../tui/workspace/live-engine"
import { tabTitleStable } from "../../../tui/workspace/terminal-tab-split"
import { tabPtyKeyFor } from "../../../tui/workspace/terminal-tabs-core"
import { adoptTaskTabs } from "../../workspace/terminal-tabs-adopt"
import type { TabsSnapshotKv } from "../../workspace/terminal-tabs-persist"
import { knownTaskTabs } from "../../workspace/terminal-tabs-shared"
import { filterKnownOrphanTabs, orphanTabsByTask } from "./orphan-tabs"
import { useHostSessions } from "./use-host-sessions"

export interface TabsByTaskOpts {
  readonly tasks: readonly Task[]
  /** Null when no KV provider is mounted — see `knownTaskTabs`. */
  readonly kv: TabsSnapshotKv | null
}

/** taskId → its tabs, live. Absent means "never mounted since restart", which
 *  is NOT the same as having no tabs — the hide rules turn on that difference. */
export function useTabsByTask(opts: TabsByTaskOpts): ReadonlyMap<string, readonly TreeTab[]> {
  const { tasks, kv } = opts

  // Live process identity (the `ps`-walk store): a user-typed `claude` in a
  // shell tab IS an agent while that process lives, and stops being one the
  // moment it exits — the same rule the strip/turn-polls use. Subscribing
  // here is what re-renders the tree when a shell becomes an agent; the
  // store notifies only when some key's vendor actually MOVED.
  const liveEngines = getDefaultLiveEngines()
  const [liveTick, setLiveTick] = useState(0)
  useEffect(() => liveEngines.subscribe(() => setLiveTick((tick) => tick + 1)), [liveEngines])

  // Live pty-host inventory, for tasks the snapshot can't answer for.
  const hostSessions = useHostSessions()

  // Feed the host inventory's pids into the live-engine probe: the local PTY
  // registry only knows tabs THIS process attached, but the tree renders every
  // task's hosted tabs — without the aux pids a `claude` typed into another
  // task's shell tab never lights up until you visit it.
  useEffect(() => {
    const pids = new Map<string, number>()
    for (const session of hostSessions) {
      if (session.alive !== false && typeof session.pid === "number" && session.pid > 0) {
        pids.set(session.key, session.pid)
      }
    }
    liveEngines.setAuxPids(pids)
    return () => liveEngines.setAuxPids(new Map())
  }, [hostSessions, liveEngines])

  // ptyKey → the host's LIVE OSC title. The host scans every session's
  // output whether or not anyone attached, so this answers for tabs whose
  // `TerminalTabs` is not mounted — the ones whose recorded `lastTitle`
  // only moves when you click into them, which leaves a row whose state glyph
  // is live (daemon engine-state channel) sitting beside a frozen title.
  // Empty titles are dropped: `""` is the host's "child has set
  // no title yet", not a name, and letting it through would blank a row that
  // has a perfectly good recorded one.
  const liveTitles = useMemo<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>()
    for (const session of hostSessions) {
      const title = session.title?.trim()
      if (title) map.set(session.key, title)
    }
    return map
  }, [hostSessions])

  // ptyKey → "the host is holding this as a freeze-restored corpse". The
  // scrollback survived a host death; the process did not, and opening the
  // tab respawns its recorded launch command. Nothing else in the tree
  // distinguishes that from a quiet tab.
  const restoredKeys = useMemo<ReadonlySet<string>>(() => {
    const keys = new Set<string>()
    for (const session of hostSessions) if (session.restored === true) keys.add(session.key)
    return keys
  }, [hostSessions])

  // Tab projection. `tasks` identity changes on every daemon snapshot echo,
  // which is also exactly when a tab's live title may have moved — so this
  // recomputing with it is correct, not wasteful.
  const snapshotTabs = useMemo<ReadonlyMap<string, readonly TreeTab[]>>(() => {
    void liveTick
    const map = new Map<string, readonly TreeTab[]>()
    for (const task of tasks) {
      const known = knownTaskTabs(kv, task.id)
      if (!known) continue
      const vendor = task.vendor ?? DEFAULT_TASK_VENDOR
      map.set(
        task.id,
        known.tabs.map((tab) => {
          // Tri-state live identity: a vendor / "confirmed no engine" (null) /
          // "can't look" (undefined — no attached PTY, e.g. right after a TUI
          // restart). Only the can't-look case falls back to the RECORDED
          // `liveVendor` (itself tri-state — the persisted twin); a confirmed
          // engine-free shell must not resurrect the identity of whatever ran
          // there before — a ctrl+C'd codex would keep its tab labelled
          // "codex N" if the recorded value were a blanket fallback.
          const ptyKey = tabPtyKeyFor(task.id, tab)
          const probed = liveEngines.resolve(ptyKey)
          const live = probed === undefined ? tab.liveVendor : probed
          return {
            id: tab.id,
            // `tabTitleStable`, NOT `tabTitle`: for a status-owning engine the
            // recorded title IS its self-reported status (`⠐ 利用自进化…`), so
            // the row would wear a spinner phrase that contradicts the state
            // glyph right next to it, which kobe derives from daemon activity.
            // The host's live title rides in as an argument (not painted
            // directly) so it goes through that same strip.
            label: tabTitleStable(tab, vendor, live, liveTitles.get(ptyKey)),
            // The active tab carries the task's state glyph (activity is
            // task-scoped; the active tab is the session it describes).
            active: tab.id === known.activeId,
            // Agent = a kobe-launched engine tab, OR a tab whose live process
            // is an engine right now (user typed `claude` in a shell), OR one
            // whose RECORDED identity says so while the live probe can't
            // answer: hosted PTYs keep the process alive across TUI restarts,
            // but the fresh registry has nothing to walk until the tab
            // re-mounts, and demoting the row to a plain dot for that gap
            // reads as a lie.
            engine: tab.kind === "engine" || (live ?? null) !== null,
            // The row's caption comes from this: what the process IS, probed
            // from the pty child's tree, not what someone configured.
            liveVendor: live ?? null,
            restored: restoredKeys.has(ptyKey),
          }
        }),
      )
    }
    return map
  }, [tasks, kv, liveEngines, liveTick, liveTitles, restoredKeys])

  // Backstop: any LIVE pty session the snapshots don't answer for becomes an
  // explicit unregistered row — tab-granular, so a task whose snapshot lists
  // tab-2 while tab-1 is alive still shows tab-1 rather than hiding a live
  // engine. See `orphan-tabs.ts`.
  const orphansByTask = useMemo<ReadonlyMap<string, readonly TreeTab[]>>(() => {
    const registered = new Set<string>()
    for (const [taskId, tabs] of snapshotTabs) for (const tab of tabs) registered.add(tabRowId(taskId, tab.id))
    // A just-closed tab's session can outlive its state in the 2s poll —
    // treating it as an orphan would adopt it right back (see
    // closed-tab-suppress.ts).
    const sessions = hostSessions.filter((session) => !isRecentlyClosedPtyKey(session.key))
    // Membership via one Set build (tree-core), not a per-orphan `tasks.some`.
    return filterKnownOrphanTabs(tasks, orphanTabsByTask(sessions, registered))
  }, [snapshotTabs, hostSessions, tasks])

  // …and then it stops being unregistered: a row nobody can open or close is
  // worse than the divergence it reports — a live engine you can neither read
  // nor end. Adoption writes the session into the task's
  // tab state, so the ⚠ row turns into an ordinary tab on the next tick —
  // idempotent, so the poll driving it costs nothing once reconciled.
  useEffect(() => {
    if (!kv) return
    for (const [taskId, orphans] of orphansByTask) {
      adoptTaskTabs(
        kv,
        taskId,
        orphans.map((tab) => tab.id),
      )
    }
  }, [orphansByTask, kv])

  const tabsByTask = useMemo<ReadonlyMap<string, readonly TreeTab[]>>(() => {
    if (orphansByTask.size === 0) return snapshotTabs
    const map = new Map<string, readonly TreeTab[]>(snapshotTabs)
    for (const [taskId, orphans] of orphansByTask) {
      const existing = map.get(taskId)
      // Appended under a task with snapshot tabs, an orphan is never the
      // active one — the snapshot's activeId owns that.
      map.set(taskId, existing ? [...existing, ...orphans.map((tab) => ({ ...tab, active: false }))] : orphans)
    }
    return map
  }, [snapshotTabs, orphansByTask])

  return tabsByTask
}
