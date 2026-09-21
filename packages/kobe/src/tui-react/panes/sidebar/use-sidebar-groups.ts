/**
 * The sidebar's sections, for whichever surface is rendering them.
 *
 * The sidebar forks into two renderers — the expanded tree and the folded
 * rail — and only one of them is mounted at a time. That fork is exactly where
 * the two used to drift apart: the tree derived its projects from
 * `buildTreeRows` while the rail re-derived its own from the raw task list, so
 * a project the tree hid was still a divider in the fold.
 *
 * This hook is the fix's shape: the fork now happens BELOW one answer. Both
 * surfaces call this, both get `SidebarGroup[]` from the same pure builder,
 * and neither is in a position to invent a grouping of its own.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { useMemo } from "react"
import type { TaskSortMode } from "../../../tui/panes/sidebar/groups"
import { type SidebarGroup, buildSidebarGroups } from "../../../tui/panes/sidebar/project-groups"
import type { TreeTab } from "../../../tui/panes/sidebar/tree-core"
import type { TabsSnapshotKv } from "../../workspace/terminal-tabs-persist"
import { useTabsByTask } from "./use-tabs-by-task"

export interface SidebarGroupsOpts {
  readonly tasks: readonly Task[]
  /** Null when no KV provider is mounted — see `knownTaskTabs`. */
  readonly kv: TabsSnapshotKv | null
  /** Global task sort driven by the `t` chord. */
  readonly sortMode?: TaskSortMode
  /** Daemon-pushed per-task activity — what `attention` sort ranks by. */
  readonly engineState?: ReadonlyMap<string, TaskEngineState>
}

export interface SidebarGroupsState {
  /** Sections in render order: the scratch bench, then the visible projects. */
  readonly groups: readonly SidebarGroup[]
  /** The projection the groups were decided from — the tree also renders tab
   *  rows out of it, so handing it back costs nothing and guarantees the rows
   *  and the grouping were computed from the same instant. */
  readonly tabsByTask: ReadonlyMap<string, readonly TreeTab[]>
}

export function useSidebarGroups(opts: SidebarGroupsOpts): SidebarGroupsState {
  const { tasks } = opts
  const tabsByTask = useTabsByTask({ tasks, kv: opts.kv })
  const sortMode = opts.sortMode ?? "default"
  // Only `attention` reads activity, so the other two modes keep their memo
  // free of a map that churns on every daemon push.
  const sortEngineState = sortMode === "attention" ? opts.engineState : undefined
  const groups = useMemo(() => {
    // The whole entry, not just its state: `attention` sort ranks by the
    // derived task group, whose debounces read the transition timestamp.
    const activityOf = (taskId: string) => sortEngineState?.get(taskId)
    return buildSidebarGroups({ tasks, tabsByTask, sortMode, activityOf })
  }, [tasks, tabsByTask, sortMode, sortEngineState])
  return { groups, tabsByTask }
}
