/**
 * Which task the user is on: selected state, adopt-first-focus, the
 * deleting-task PTY sweep, select/activate. They drift together, so they live
 * together. The framework-free activation POLICY is in `use-task-selection.ts`;
 * this hook owns only the reactivity.
 */

import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { aliasedKeys, isUnderKey } from "@sma1lboy/rove-daemon/daemon/pty-alias"
import { useEffect, useRef, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator.ts"
import { readLastActiveTaskId } from "../../state/last-active.ts"
import type { TabsSnapshotKv } from "../../tabs/terminal-tabs-persist"
import { defaultShell } from "../../tui/panes/terminal/pty-types"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { useT } from "../i18n"
import { useLatest } from "../lib/use-latest"
import { forgetTaskTabs, knownTaskTabs, reviveEmptiedTabs } from "./terminal-tabs-shared"
import {
  activateWorkspaceTask,
  activationErrorMessage,
  firstSelectableTask,
  previousTaskTarget,
} from "./use-task-selection"

/** What {@link useWorkspaceSelection} reports when a worktree vanishes under a task. */
export interface WorktreeGoneEvent {
  readonly taskId: string
  readonly title: string
  readonly branch: string
  /** How many tab snapshots were dropped (0 when the task never mounted tabs). */
  readonly closed: number
}

export interface WorkspaceSelection {
  readonly selectedId: string | null
  readonly setSelectedId: (id: string | null) => void
  readonly selectedTask: Task | undefined
  /** Click/cursor selection — publishes the shared active-task focus. */
  readonly selectTask: (id: string) => void
  /** Enter/double-click activation — materializes the worktree if needed. */
  readonly activateTask: (id: string) => Promise<void>
  /** Re-enter the task the user was on before this one; false when there is none to go back to. */
  readonly backToPreviousTask: () => boolean
}

export function useWorkspaceSelection(args: {
  readonly orch: RemoteOrchestrator
  readonly tasks: readonly Task[]
  readonly activeTaskId: string | null
  readonly focusWorkspace: () => void
  readonly kv: TabsSnapshotKv
  /** A task's worktree disappeared out-of-band and its tabs were dropped. */
  readonly notifyWorktreeGone?: (event: WorktreeGoneEvent) => void
  /** Refused activation (mid-delete, non-git project, worktree failure); the on-screen half of `reportError`. */
  readonly notifyError?: (message: string) => void
  /** The selected task was archived, deleted or went away: the host shows the global New task in its place. */
  readonly onSelectedLeft?: () => void
}): WorkspaceSelection {
  const { orch, tasks, activeTaskId, kv } = args
  const t = useT()
  // Daemon's replayed focus, else persisted lastActive; the effect below
  // corrects a stale/deleting id.
  const [selectedId, setSelectedId] = useState<string | null>(() => orch.activeTaskSignal()() ?? readLastActiveTaskId())

  const focusRestoredRef = useRef(false)
  const userPickedRef = useRef(false)
  const bootFocusRef = useRef(false)
  // The selected id while it was listed (not archived, not deleting); null otherwise.
  const liveSelectedRef = useRef<string | null>(null)
  // The task the USER left for the current one; automatic moves (archive, delete) don't record.
  const previousIdRef = useRef<string | null>(null)
  // Nothing selected on purpose (the selected task left): no fallback pick until the user selects one.
  const parkedRef = useRef(false)
  const onSelectedLeftRef = useLatest(args.onSelectedLeft)
  // Adopt the daemon's first restored focus, but never let later sibling-client
  // events yank a task the local user already selected.
  useEffect(() => {
    if (!focusRestoredRef.current && activeTaskId && tasks.some((task) => task.id === activeTaskId)) {
      focusRestoredRef.current = true
      if (!userPickedRef.current && selectedId !== activeTaskId) {
        setSelectedId(activeTaskId)
        return
      }
    }
    // One-shot: boot lands focus IN the restored session (reopening resumes
    // where you quit) until the user picks something. No restorable task →
    // sidebar keeps focus.
    if (!bootFocusRef.current && !userPickedRef.current && selectedId && tasks.some((task) => task.id === selectedId)) {
      bootFocusRef.current = true
      args.focusWorkspace()
    }
    if (selectedId !== null) parkedRef.current = false
    // The open task archived, deleting or gone: nothing selected, and New task in its place. Opening an
    // archived task from the fold is no change, so that one stays open. A deleting task must not stay
    // selected: its mounted Terminal answers the sweep's kill with a dead-on-attach RESUME.
    const selected = selectedId ? tasks.find((task) => task.id === selectedId) : undefined
    const wasLive = selectedId !== null && liveSelectedRef.current === selectedId
    const live = selected !== undefined && selected.archived !== true && !selected.deletion
    liveSelectedRef.current = live ? selectedId : null
    if (wasLive && !live) {
      parkedRef.current = true
      setSelectedId(null)
      // silent-catch-ok: focus bookkeeping; the task is gone either way.
      if (orch.activeTaskSignal()() === selectedId) void orch.setActiveTask(null).catch(() => {})
      onSelectedLeftRef.current?.()
      return
    }
    if (selectedId && tasks.some((task) => task.id === selectedId && !task.deletion)) return
    if (selectedId === null && parkedRef.current) return
    // Pass lastActive too: a stale or respawned daemon can replay a null focus
    // while disk knows the real one.
    setSelectedId(firstSelectableTask(tasks, activeTaskId, readLastActiveTaskId())?.id ?? null)
  }, [orch, tasks, activeTaskId, selectedId, args.focusWorkspace])

  // The one place tab shells die with their task: tab PTYs are keyed
  // `taskId::tabId` in the default registry, invisible once the pane unmounts,
  // and the pane never kills.
  //
  // The notifier is held by REF (useLatest): the host rebuilds it every render,
  // and re-running this effect would rewrite `worktreePathsRef`, the baseline
  // the transition below is measured against.
  const notifyWorktreeGoneRef = useLatest(args.notifyWorktreeGone)
  const liveTaskIdsRef = useRef<ReadonlySet<string>>(new Set())
  const worktreePathsRef = useRef<ReadonlyMap<string, string>>(new Map())
  useEffect(() => {
    const next = new Set<string>(tasks.filter((task) => !task.deletion).map((task) => task.id))
    const registry = getDefaultPtyRegistry()
    // A surviving child's conversation may still be keyed under the task that left.
    const aliased = aliasedKeys(tasks.filter((task) => !task.deletion))
    for (const id of liveTaskIdsRef.current) {
      if (next.has(id)) continue
      registry.releaseWhere(
        (key) => (key === id || key.startsWith(`${id}::`)) && !aliased.some((base) => isUnderKey(key, base)),
      )
    }
    liveTaskIdsRef.current = next
    // Tabs die WITH their worktree: a worktree removed elsewhere clears
    // `worktreePath` but keeps the task, leaving tab rows, a respawning
    // snapshot, and shells alive in a deleted directory. Non-empty → empty is
    // the edge; task deletion is covered above.
    //
    // ANNOUNCE IT: this destroys tabs the user didn't delete, triggered
    // elsewhere. A toast, not a confirm: the worktree is already gone, there's
    // nothing to consent to. Saying what happened (and that the branch
    // survives) is the whole remedy.
    const paths = new Map<string, string>()
    for (const task of tasks) paths.set(task.id, task.worktreePath)
    for (const [id, prevPath] of worktreePathsRef.current) {
      const now = paths.get(id)
      if (now === "" && prevPath !== "") {
        const closed = knownTaskTabs(kv, id)?.tabs.length ?? 0
        registry.releaseWhere((key) => key === id || key.startsWith(`${id}::`))
        forgetTaskTabs(kv, id)
        const task = tasks.find((candidate) => candidate.id === id)
        notifyWorktreeGoneRef.current?.({
          taskId: id,
          title: task?.title ?? id,
          branch: task?.branch ?? "",
          closed,
        })
      }
    }
    worktreePathsRef.current = paths
  }, [tasks, kv])

  // Last-intent-wins: a slow activation that resolves after a newer pick (another
  // activation, or a direct select such as an Inbox jump) must not yank selection back.
  const activationGenerationRef = useRef(0)

  function selectTask(id: string): void {
    activationGenerationRef.current++
    commitSelection(id)
  }

  function commitSelection(id: string): void {
    userPickedRef.current = true
    if (selectedId === id) {
      // Still publish it as active: a fresh home boots with a fallback-selected
      // task but a null active record, so the first Enter must write lastActive
      // (narrow mode's "↩ recent" row reads it). No toast on failure: the pane
      // already switched, only the record is lost.
      if (orch.activeTaskSignal()() !== id)
        // silent-catch-ok: focus bookkeeping, see above.
        void orch.setActiveTask(id).catch((error) => console.error("[rove workspace] setActiveTask failed:", error))
      return
    }
    if (selectedId !== null) previousIdRef.current = selectedId
    setSelectedId(id)
    // silent-catch-ok: same focus-bookkeeping write as above.
    void orch.setActiveTask(id).catch((error) => console.error("[rove workspace] setActiveTask failed:", error))
    // Plugin UI events: entering a task is an observable moment.
    orch.reportUiEvent("task.opened", id)
  }

  async function activateTask(id: string): Promise<void> {
    const generation = ++activationGenerationRef.current
    // Revive before the worktree await, so the tab exists when selection
    // lands and the blank empty-tab-list frame never paints.
    reviveEmptiedTabs(kv, id, defaultShell())
    await activateWorkspaceTask(
      {
        getTask: (taskId) => tasks.find((task) => task.id === taskId),
        ensureWorktree: (taskId) => orch.ensureWorktree(taskId),
        selectTask: commitSelection,
        focusWorkspace: args.focusWorkspace,
        reportError: (error) => {
          // Without the toast a refused Enter is a silent no-op, pressed forever.
          console.error("[rove workspace] task.ensureWorktree failed:", error)
          args.notifyError?.(activationErrorMessage(error, t))
        },
        isCurrent: () => activationGenerationRef.current === generation,
      },
      id,
    )
  }

  function backToPreviousTask(): boolean {
    const id = previousTaskTarget(tasks, previousIdRef.current, selectedId)
    if (id === null) return false
    void activateTask(id)
    return true
  }

  const selectedTask = selectedId ? tasks.find((task) => task.id === selectedId) : undefined
  return { selectedId, setSelectedId, selectedTask, selectTask, activateTask, backToPreviousTask }
}
