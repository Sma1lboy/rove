/**
 * Workspace task selection — extracted verbatim from WorkspaceRoot
 * (file-size cap split): the selected-task state, the adopt-first-focus
 * rule, the deleting-task PTY sweep, and the select/activate actions.
 * The framework-free activation policy stays in use-task-selection.ts; this
 * hook owns only the React reactivity.
 */

import { useEffect, useRef, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator.ts"
import { readLastActiveTaskId } from "../../state/last-active.ts"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import type { Task } from "../../types/task.ts"
import { useLatest } from "../lib/use-latest"
import { type TabsSnapshotKv, sweepOrphanTabsSnapshots } from "./terminal-tabs-persist"
import { forgetTaskTabs, knownTaskTabs } from "./terminal-tabs-shared"
import { activateWorkspaceTask, firstSelectableTask } from "./use-task-selection"

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
}

export function useWorkspaceSelection(args: {
  readonly orch: RemoteOrchestrator
  readonly tasks: readonly Task[]
  readonly activeTaskId: string | null
  readonly focusWorkspace: () => void
  readonly kv: TabsSnapshotKv
  /** A task's worktree disappeared out-of-band and its tabs were dropped. */
  readonly notifyWorktreeGone?: (event: WorktreeGoneEvent) => void
}): WorkspaceSelection {
  const { orch, tasks, activeTaskId, kv } = args
  // Seed from the daemon's replayed focus, else the persisted lastActive
  // record — the adopt/fallback effect below corrects a stale/deleting id.
  const [selectedId, setSelectedId] = useState<string | null>(() => orch.activeTaskSignal()() ?? readLastActiveTaskId())

  const focusRestoredRef = useRef(false)
  const userPickedRef = useRef(false)
  const bootFocusRef = useRef(false)
  // Adopt the daemon's first restored focus, but never let later events from
  // sibling clients yank a task the local user already selected.
  useEffect(() => {
    if (!focusRestoredRef.current && activeTaskId && tasks.some((task) => task.id === activeTaskId)) {
      focusRestoredRef.current = true
      if (!userPickedRef.current && selectedId !== activeTaskId) {
        setSelectedId(activeTaskId)
        return
      }
    }
    // Boot lands IN the restored session (owner 2026-08-09): reopening kobe
    // resumes where you quit, so the content pane — not the sidebar — should
    // hold focus. One-shot, only while the user hasn't picked anything yet;
    // a boot with no restorable task leaves the sidebar focused (cold-start
    // default, nothing to resume into).
    if (!bootFocusRef.current && !userPickedRef.current && selectedId && tasks.some((task) => task.id === selectedId)) {
      bootFocusRef.current = true
      args.focusWorkspace()
    }
    // A deleting task is NOT a valid selection (issue #34): the snapshot
    // still contains it, but its sidebar row is gone (#473) and the PTY sweep
    // below kills its sessions — leaving selection on it kept its Terminal
    // mounted, which answered the kill with a dead-on-attach RESUME.
    if (selectedId && tasks.some((task) => task.id === selectedId && !task.deletion)) return
    // Fallback carries the persisted lastActive record too — a stale or
    // freshly-respawned daemon can replay a null focus while disk still
    // knows the real one (the "reopens on the oldest project" bug).
    setSelectedId(firstSelectableTask(tasks, activeTaskId, readLastActiveTaskId())?.id ?? null)
  }, [tasks, activeTaskId, selectedId, args.focusWorkspace])

  // One-time orphan sweep (O19): clear `terminalTabs.*` snapshots whose task
  // no longer exists. Runs once on first hydration; ref not dep, so a later
  // task-list change never re-sweeps a live task's fresh snapshot.
  //
  // The `tasks.length === 0` guard is load-bearing and SUFFICIENT, despite
  // reading like a weak null-check: this list is only ever assigned from the
  // daemon's own index (`hello.tasks` / `task.snapshot` — nothing else calls
  // `setTasks`), a corrupt or unreadable manifest recovers to an EMPTY index
  // rather than a truncated one, and a daemon serving a foreign home is
  // rejected before its list is believed. So a NON-EMPTY list here is the
  // daemon's authoritative task set, and anything absent from it is a genuine
  // orphan. Do not relax the empty check — empty is exactly the shape a
  // pre-connection render and a corrupt-manifest recovery both take, and
  // sweeping on it would wipe every live snapshot on the machine.
  const sweptOrphansRef = useRef(false)
  useEffect(() => {
    if (sweptOrphansRef.current || tasks.length === 0) return
    sweptOrphansRef.current = true
    sweepOrphanTabsSnapshots(
      kv,
      tasks.map((task) => task.id),
    )
  }, [tasks, kv])

  // PTY lifecycle (issue #16): deleting a task must end every engine session
  // it owns — its tab PTYs are keyed `taskId::tabId` in the default registry,
  // invisible to the pane once unmounted. Watch the task snapshot and release
  // the corpses; the pane never kills (registry docs), so this is the one
  // place tab shells die with their task.
  //
  // The worktree-gone notifier is held by REF, not listed as a dep: the host
  // rebuilds that callback every render, and depending on it would re-run this
  // effect each render — which also rewrites `worktreePathsRef`, the very
  // thing the transition below is measured against. Same useLatest shape
  // use-inbox-host uses for its notifiers.
  const notifyWorktreeGoneRef = useLatest(args.notifyWorktreeGone)
  const liveTaskIdsRef = useRef<ReadonlySet<string>>(new Set())
  const worktreePathsRef = useRef<ReadonlyMap<string, string>>(new Map())
  useEffect(() => {
    const next = new Set<string>(tasks.filter((task) => !task.deletion).map((task) => task.id))
    const registry = getDefaultPtyRegistry()
    for (const id of liveTaskIdsRef.current) {
      if (!next.has(id)) registry.releaseWhere((key) => key === id || key.startsWith(`${id}::`))
    }
    liveTaskIdsRef.current = next
    // Chattabs die WITH their worktree (owner call 2026-08-01): removing a
    // task's worktree (worktrees page / web / a sibling client) clears its
    // `worktreePath` but keeps the task — without this, its tab rows stayed
    // in the tree, its snapshot would respawn them, and their PTYs kept
    // shells alive in a deleted directory. A non-empty → empty transition
    // is the observable edge; task deletion itself is already covered by
    // the delete flow's forgetTaskTabs + the live-task sweep above.
    //
    // ANNOUNCE IT. This destroys every tab of a task the user did NOT delete,
    // triggered by something that happened somewhere else (another client, a
    // web action, another agent's `rove api`) — and it did it silently, which
    // is how "the tab I was working in just vanished" reached the owner with
    // nothing to look at (2026-08-29). The toast is deliberately not a
    // confirm: the worktree is ALREADY gone by the time this runs, so there is
    // nothing left to consent to, and a modal here would interrupt for a
    // decision the user cannot make. Telling them what happened, and that the
    // branch survives, is the whole remedy.
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

  function selectTask(id: string): void {
    userPickedRef.current = true
    if (selectedId === id) {
      // Entering the already-selected task must still publish it as active:
      // a fresh home boots with a fallback-selected task but a null active
      // record, and without this the first Enter never wrote lastActive —
      // so narrow mode's "↩ recent" row (and every lastActive consumer)
      // stayed empty until the user switched tasks once.
      if (orch.activeTaskSignal()() !== id)
        void orch.setActiveTask(id).catch((error) => console.error("[rove workspace] setActiveTask failed:", error))
      return
    }
    setSelectedId(id)
    void orch.setActiveTask(id).catch((error) => console.error("[rove workspace] setActiveTask failed:", error))
    // Plugin UI events: entering a task/project is an observable moment.
    const kind = tasks.find((task) => task.id === id)?.kind === "main" ? "project.opened" : "task.opened"
    orch.reportUiEvent(kind, id)
  }

  // Last-intent-wins: a slow activation that resolves after a newer one must
  // not yank selection/focus back to the older task.
  const activationGenerationRef = useRef(0)
  async function activateTask(id: string): Promise<void> {
    const generation = ++activationGenerationRef.current
    await activateWorkspaceTask(
      {
        getTask: (taskId) => tasks.find((task) => task.id === taskId),
        ensureWorktree: (taskId) => orch.ensureWorktree(taskId),
        selectTask,
        focusWorkspace: args.focusWorkspace,
        reportError: (error) => console.error("[rove workspace] task.ensureWorktree failed:", error),
        isCurrent: () => activationGenerationRef.current === generation,
      },
      id,
    )
  }

  const selectedTask = selectedId ? tasks.find((task) => task.id === selectedId) : undefined
  return { selectedId, setSelectedId, selectedTask, selectTask, activateTask }
}
