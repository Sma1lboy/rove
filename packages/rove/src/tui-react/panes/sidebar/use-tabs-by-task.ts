/**
 * What tabs each task has RIGHT NOW. Sits ABOVE the collapsed/expanded fork:
 * "does this task have tabs" decides whether its project shows at all.
 *
 * Three sources, in order of authority:
 *   1. the KV snapshot (`knownTaskTabs`), for tasks whose `TerminalTabs`
 *      never mounted (every task after a restart);
 *   2. the live pty host inventory: titles and freeze-restored corpses;
 *   3. the orphan backstop: live sessions no snapshot claims, adopted into
 *      the snapshot.
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

  // Live process identity: a user-typed `claude` in a shell IS an agent while
  // it lives. The store notifies only when some key's vendor MOVED.
  const liveEngines = getDefaultLiveEngines()
  const [liveTick, setLiveTick] = useState(0)
  useEffect(() => liveEngines.subscribe(() => setLiveTick((tick) => tick + 1)), [liveEngines])

  const hostSessions = useHostSessions()

  // The local PTY registry only knows tabs THIS process attached; aux pids let
  // the probe see every task's hosted tabs.
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

  // ptyKey → the host's LIVE OSC title, for unmounted tabs whose recorded
  // `lastTitle` would otherwise freeze. `""` means "no title yet", so it is
  // dropped rather than blanking a recorded one.
  const liveTitles = useMemo<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>()
    for (const session of hostSessions) {
      const title = session.title?.trim()
      if (title) map.set(session.key, title)
    }
    return map
  }, [hostSessions])

  // ptyKeys the host holds as freeze-restored corpses (opening one respawns).
  const restoredKeys = useMemo<ReadonlySet<string>>(() => {
    const keys = new Set<string>()
    for (const session of hostSessions) if (session.restored === true) keys.add(session.key)
    return keys
  }, [hostSessions])

  // Recomputing on every `tasks` echo is correct: that's when live titles move.
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
          // Tri-state: vendor / null (confirmed no engine) / undefined (can't
          // look, e.g. after a restart). Only undefined falls back to the
          // RECORDED `liveVendor`, or a ctrl+C'd codex would keep its label.
          const ptyKey = tabPtyKeyFor(task.id, tab)
          const probed = liveEngines.resolve(ptyKey)
          const live = probed === undefined ? tab.liveVendor : probed
          return {
            id: tab.id,
            // `tabTitleStable`, NOT `tabTitle`: a status-owning engine's title
            // IS its status (`⠐ 利用自进化…`), contradicting the state glyph.
            // The host's live title goes through the same strip.
            label: tabTitleStable(tab, vendor, live, liveTitles.get(ptyKey)),
            active: tab.id === known.activeId,
            // Agent = engine tab, OR a live (or, when unprobeable, recorded)
            // engine process: hosted PTYs outlive a TUI restart.
            engine: tab.kind === "engine" || (live ?? null) !== null,
            liveVendor: live ?? null,
            restored: restoredKeys.has(ptyKey),
          }
        }),
      )
    }
    return map
  }, [tasks, kv, liveEngines, liveTick, liveTitles, restoredKeys])

  // Backstop: see `orphan-tabs.ts`.
  const orphansByTask = useMemo<ReadonlyMap<string, readonly TreeTab[]>>(() => {
    const registered = new Set<string>()
    for (const [taskId, tabs] of snapshotTabs) for (const tab of tabs) registered.add(tabRowId(taskId, tab.id))
    // A just-closed tab's session can outlive it in the 2s poll; don't re-adopt it.
    const sessions = hostSessions.filter((session) => !isRecentlyClosedPtyKey(session.key))
    return filterKnownOrphanTabs(tasks, orphanTabsByTask(sessions, registered))
  }, [snapshotTabs, hostSessions, tasks])

  // Adopt orphans into the task's tab state so the ⚠ row becomes an ordinary,
  // closable tab next tick. Idempotent.
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
      // The snapshot's activeId owns "active".
      map.set(taskId, existing ? [...existing, ...orphans.map((tab) => ({ ...tab, active: false }))] : orphans)
    }
    return map
  }, [snapshotTabs, orphansByTask])

  return tabsByTask
}
