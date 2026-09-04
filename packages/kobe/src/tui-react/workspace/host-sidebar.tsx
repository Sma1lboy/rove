/** @jsxImportSource @opentui/react */
/**
 * The workspace host's left rail — which sidebar renders, and its wiring.
 *
 * Its own component because `host.tsx` should compose the workspace, not know
 * how one rail is wired. The props below are that wiring made explicit —
 * having to pass them is the honest cost of the boundary, and it is why a new
 * sidebar concern lands here instead of accreting on the host.
 *
 * The fourteen task-lifecycle callbacks are NOT re-declared here: they come
 * from {@link SidebarTaskCallbacks}, whose whole point is that the surfaces
 * can't drift. They arrive here REQUIRED (the host supplies every one) except
 * `onLandRequest`, which stays optional exactly as the shared type has it.
 */

import type { TaskEngineState, TaskJobState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { type MutableRefObject, useCallback } from "react"
import type { TaskSortMode } from "../../tui/panes/sidebar/groups"
import type { SidebarNav } from "../../tui/panes/sidebar/nav-core"
import type { WorktreeChanges } from "../../tui/panes/sidebar/worktree-changes"
import { PaneKeyHint } from "../component/keyboard-hints"
import { useKV } from "../context/kv"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { SidebarTree } from "../panes/sidebar/SidebarTree"
import type { SidebarTaskCallbacks } from "../panes/sidebar/types"
import { closeTaskTab } from "./terminal-tabs-close"
import { moveTaskTab } from "./terminal-tabs-move"
import { requestNewTab } from "./terminal-tabs-shared"

export interface HostSidebarProps
  extends Readonly<Required<Omit<SidebarTaskCallbacks, "onLandRequest">>>,
    Readonly<Pick<SidebarTaskCallbacks, "onLandRequest">> {
  readonly width: number
  readonly nav: SidebarNav
  readonly onNavChange: (nav: SidebarNav) => void
  readonly tasks: readonly Task[]
  readonly selectedId: string | null
  readonly selectedTabId: string | null
  readonly onSelect: (taskId: string) => void
  readonly onActivate: (taskId: string) => void
  readonly onSelectTab: (taskId: string, tabId: string) => void
  readonly focused: boolean
  readonly engineState?: ReadonlyMap<string, TaskEngineState>
  /** Per-tab activity, keyed taskId → tabId. The tree lights the exact tab. */
  readonly engineTabState?: ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>>
  readonly engineLifecycle?: ReadonlyMap<string, { readonly subagents: number }>
  readonly taskJobs?: ReadonlyMap<string, TaskJobState>
  readonly worktreeChanges?: ReadonlyMap<string, WorktreeChanges | null> | null
  readonly transcriptActivity?: ReadonlyMap<string, { readonly mtimeMs: number }> | null
  readonly onAddTask: () => void
  readonly onSearchActiveChange: (active: boolean) => void
  readonly headerStatus: { label: string; emphasize: boolean }
  readonly onHeaderStatusClick: () => void
  /** "newer version on npm" chip beside the brand text; null hides it. */
  readonly updateChip?: { label: string } | null
  readonly onUpdateChipClick?: () => void
  readonly zenActive: boolean
  readonly onZenClick: () => void
  readonly onFocusRequest: () => void
  /** Narrow mode's "↩ recent" jump row target. */
  readonly recentTask?: Task | null
  /** Global task sort mode driven by the `t` chord. */
  readonly sortMode?: TaskSortMode
  /** Reader of the task under the tree cursor — see `SidebarTreeProps`. */
  readonly cursorTaskIdRef?: MutableRefObject<() => string | null>
}

export function HostSidebar(props: HostSidebarProps) {
  const { onFocusRequest: _rail, recentTask: _recent, ...treeProps } = props
  const { theme } = useTheme()
  const kv = useKV()
  const notif = useNotifications()
  const t = useT()
  // Tab close is the one sidebar action the host can't express as a task-level
  // callback: the tree names a tab of ANY worktree, so who owns that tab's
  // state depends on whether its TerminalTabs is mounted. `closeTaskTab` is
  // where that fork lives; a failure surfaces as a toast rather than a silent
  // no-op. Closing the LAST tab is not a failure (it empties the list and the
  // row is revived on re-entry), so the only false left is a tab the tree
  // still lists but the state does not have — a stale row, not a refusal.
  const closeTab = useCallback(
    (taskId: string, tabId: string): void => {
      if (!closeTaskTab(kv, taskId, tabId))
        notif.notify({ kind: "error", taskId, tabId, title: t("terminal.tab.tabGone") })
    },
    [kv, notif, t],
  )
  // Tab reorder is tab close's sibling (move mode on a tab row):
  // same mounted-vs-background fork, same "who owns this task's state"
  // question — `moveTaskTab` is where that fork lives. An edge-stop (first
  // tab up / last down) is a silent no-op, not an error.
  const moveTab = useCallback(
    (taskId: string, tabId: string, delta: -1 | 1): void => {
      moveTaskTab(kv, taskId, tabId, delta)
    },
    [kv],
  )
  // "New conversation" / "New shell" from a row's menu. Unlike close/move
  // there is no background path: the picker is
  // a dialog and a shell tab needs its PTY where the tabs render, so this
  // ENTERS the task first and the request is claimed by its workspace — on
  // the spot when it is already mounted, on first mount otherwise.
  const newTab = useCallback(
    (taskId: string, kind: "chat" | "shell"): void => {
      props.onActivate(taskId)
      requestNewTab(taskId, kind)
    },
    [props.onActivate],
  )
  return (
    <box
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={theme.backgroundPanel}
      onMouseUp={props.onFocusRequest}
    >
      {/* HostSidebarProps is SidebarTreeProps plus the rail's own two props,
          so the tree takes the rest wholesale rather than a re-listing of
          thirty names that can silently fall out of date. */}
      <SidebarTree
        {...treeProps}
        onCloseTab={closeTab}
        onNewTab={newTab}
        onMoveTabRequest={moveTab}
        recentTask={props.recentTask ?? null}
      />
      {/* First-use key hint (component/keyboard-hints.tsx): renders until
          the sidebar's own keys have been used, then never again. */}
      <box flexShrink={0} paddingLeft={1} paddingBottom={0}>
        <PaneKeyHint pane="sidebar" />
      </box>
    </box>
  )
}
