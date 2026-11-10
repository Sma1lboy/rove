/**
 * The sidebar's sections for both renderers (expanded tree, folded rail):
 * both get `SidebarGroup[]` from this one builder, so neither can invent its
 * own grouping.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { useMemo } from "react"
import type { TaskSortMode } from "../../../tui/panes/sidebar/groups"
import { type SidebarGroup, buildSidebarGroups } from "../../../tui/panes/sidebar/project-groups"
import type { TreeTab } from "../../../tui/panes/sidebar/tree-core"
import { tabsDaemonBacked } from "../../workspace/tabs-sync"
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
  /** Tasks a tabless main row stays listed for (the selection, a project being reordered). */
  readonly keepTaskIds?: ReadonlySet<string>
}

export interface SidebarGroupsState {
  /** Sections in render order: the scratch bench, then the visible projects. */
  readonly groups: readonly SidebarGroup[]
  /** The projection the groups came from; the tree's tab rows use it, so rows
   *  and grouping share one instant. */
  readonly tabsByTask: ReadonlyMap<string, readonly TreeTab[]>
}

export function useSidebarGroups(opts: SidebarGroupsOpts): SidebarGroupsState {
  const { tasks, keepTaskIds } = opts
  const tabsByTask = useTabsByTask({ tasks, kv: opts.kv })
  const sortMode = opts.sortMode ?? "default"
  // Only `attention` reads activity; other modes skip the per-push churn.
  const sortEngineState = sortMode === "attention" ? opts.engineState : undefined
  const groups = useMemo(() => {
    // The whole entry, not just its state: `attention` sort ranks by the
    // derived task group, whose debounces read the transition timestamp.
    const activityOf = (taskId: string) => sortEngineState?.get(taskId)
    // Read here, not as an opt: attach and detach bump `tabsRevision`, which reissues `tabsByTask`.
    return buildSidebarGroups({
      tasks,
      tabsByTask,
      tabsDaemonBacked: tabsDaemonBacked(),
      sortMode,
      activityOf,
      keepTaskIds,
    })
  }, [tasks, tabsByTask, sortMode, sortEngineState, keepTaskIds])
  return { groups, tabsByTask }
}
