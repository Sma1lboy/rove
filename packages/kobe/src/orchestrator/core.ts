/**
 * Framework-free Task and Worktree orchestrator. It owns lifecycle metadata,
 * lazy Worktree allocation, and the reactive snapshot clients subscribe to.
 * Interactive engine processes and Terminal Tab state have separate owners.
 */

import { samePath } from "@sma1lboy/kobe-daemon/path-identity"
import { type ReadableState, type StateCell, createStateCell } from "../lib/external-store.ts"
import { readLastActiveTaskId, writeLastActiveTaskId } from "../state/last-active.ts"
import { isGitRepo, resolveRepoRoot } from "../state/repos.ts"
import type { Task, TaskId, TaskPRStatus, TaskStatus, TaskWorkerReport, VendorId } from "../types/task.ts"
import type { AdoptableWorktree } from "../types/worktree.ts"
import { type OpenDirectoryTaskInput, adoptScratchRepoRow, createTaskRow, openDirectoryTaskRow } from "./core-create.ts"
import { canonPath, repoWorkingDir } from "./core-helpers.ts"
import type { CreateTaskInput } from "./create-task-input.ts"
import { TaskDeletingError, TaskNotFoundError } from "./errors.ts"
import type { TaskIndexStore, TaskIndexUnsubscribe } from "./index/store.ts"
import { type LandPreflight, landPreflight } from "./land-preflight.ts"
import { type LandResult, type LandTaskOpts, landTaskWithCleanup } from "./land.ts"
import { MainTaskCoordinator } from "./main-task.ts"
import { promotableDirTasks } from "./promote-dir-tasks.ts"
import { TaskDeletionCoordinator, type TaskDeletionOpts } from "./task-deletion.ts"
import { TaskEditor } from "./task-editor.ts"
import { PLACEHOLDER_TASK_TITLE } from "./title.ts"
import { WorktreeCoordinator } from "./worktree-coordinator.ts"
import type { GitWorktreeManager } from "./worktree/manager.ts"

// Lives in its own module so it can be imported without this class.
export type { CreateTaskInput } from "./create-task-input.ts"

export type Unsubscribe = () => void
export type TaskListListener = (snapshot: readonly Task[]) => void

export interface OrchestratorDeps {
  readonly store: TaskIndexStore
  readonly worktrees: GitWorktreeManager
  /** Called when a forced task deletion snapshotted uncommitted work before
   *  destroying it. The daemon binds this to its deletion audit log; a TUI-
   *  local orchestrator leaves it unset and the snapshot is still findable
   *  via `git for-each-ref refs/rove/salvage`. */
  readonly onSalvage?: (
    taskId: TaskId,
    salvage: { readonly ref: string; readonly commit: string; readonly uncaptured: readonly string[] },
  ) => void
  /** Called when a deletion's `git worktree remove` deregistered the worktree
   *  but could not delete its directory. The deletion still completes; this is
   *  the only record of the leftover, so the daemon binds it to the same audit
   *  log the rest of the deletion trail goes to. */
  readonly onWorktreeResidue?: (taskId: TaskId, residue: { readonly path: string; readonly reason: string }) => void
  /** Called when a deletion asked for `--delete-branch` and git refused (an
   *  unmerged branch, one another worktree has checked out). The deletion still
   *  succeeds; this is what keeps the audit line from claiming otherwise. */
  readonly onBranchKept?: (taskId: TaskId, kept: { readonly branch: string; readonly reason: string }) => void
  /** Kill a task's engine session (unset in a TUI-local orchestrator). `landTask`
   *  calls it before removing a landed worktree — an engine still writing into
   *  a directory about to be unlinked loses everything it writes next. */
  readonly tearDownSession?: (taskId: TaskId | string) => Promise<void>
}

export { PLACEHOLDER_TASK_TITLE }

/**
 * Owner of the task lifecycle: which tasks exist, which worktree each lives
 * in, its status / pinned flag. Subscribe via {@link tasksSignal} or
 * {@link subscribeTasks}.
 */
export class Orchestrator {
  private readonly store: TaskIndexStore
  private readonly worktrees: GitWorktreeManager
  /** Owns git-worktree side-effects (allocate / materialise / adopt) + their locks. */
  private readonly worktreeCoordinator: WorktreeCoordinator
  /** Owns in-place task-field edits (title / branch / vendor / status / …). */
  private readonly editor: TaskEditor
  private readonly deletions: TaskDeletionCoordinator
  private readonly tasksAcc: StateCell<Task[]>
  private readonly activeTaskAcc: StateCell<string | null>
  private readonly unsubscribeStore: TaskIndexUnsubscribe
  /** Owns the `kind:"main"` project row (create / adopt / forget). */
  private readonly mainTasks: MainTaskCoordinator
  /** Injected engine-session teardown — see {@link OrchestratorDeps.tearDownSession}. */
  private readonly tearDownSession?: (taskId: TaskId | string) => Promise<void>

  constructor(deps: OrchestratorDeps) {
    this.store = deps.store
    this.worktrees = deps.worktrees
    this.tearDownSession = deps.tearDownSession
    // `ensureIfEligible`, not `ensureMainTask`: adopting a worktree of a
    // throwaway repo must still adopt, it just must not mint a permanent
    // project row for a path that cannot be someone's project.
    this.worktreeCoordinator = new WorktreeCoordinator(this.store, this.worktrees, canonPath, (repo) =>
      this.mainTasks.ensureIfEligible(repo),
    )
    this.mainTasks = new MainTaskCoordinator(this.store, (id) => this.worktreeCoordinator.forget(id))
    this.editor = new TaskEditor(this.store, this.worktrees)
    this.deletions = new TaskDeletionCoordinator(
      this.store,
      this.worktrees,
      (id) => this.worktreeCoordinator.forget(id),
      deps.onSalvage,
      deps.onWorktreeResidue,
      deps.onBranchKept,
    )
    this.tasksAcc = createStateCell<Task[]>(this.store.list())
    // Restarts reopen on the last-focused task; a since-deleted id is dropped
    // silently and the UI's fallback picks a survivor.
    const persistedFocus = readLastActiveTaskId()
    this.activeTaskAcc = createStateCell<string | null>(
      persistedFocus && this.store.get(persistedFocus) ? persistedFocus : null,
    )
    this.unsubscribeStore = this.store.subscribe((snapshot) => {
      this.tasksAcc.set(snapshot.slice())
    })
  }

  /**
   * Awaited before the first render. Absorbs `dir` rows sitting on a repo root
   * into that repo's `main` row: such a row renders as a bare path, outside
   * every project-row behaviour (ordering, pin, the fold on a closed last tab),
   * and `ensure` only runs when somebody names the repo, so without this sweep
   * it stays wrong forever. The promoted row keeps its task id, so its terminal
   * tabs come with it.
   *
   * Best-effort: a moved repo or an unresponsive git must not stop the TUI
   * from starting.
   */
  async init(): Promise<void> {
    try {
      const promotable = promotableDirTasks({
        tasks: this.store.list(),
        isRepoRoot: (path) => isGitRepo(path) && samePath(resolveRepoRoot(path), path),
      })
      for (const task of promotable) await this.mainTasks.ensureIfEligible(task.repo, "explicit")
    } catch {
      // A failed promotion leaves the row as it was, not a boot failure.
    }
  }

  /** In-process active-task focus; mirrors {@link RemoteOrchestrator}'s
   *  daemon-backed `active-task` channel so the `KobeOrchestrator` union has one API. */
  activeTaskSignal(): ReadableState<string | null> {
    return this.activeTaskAcc
  }

  /** Set the active-task focus and touch recency for task-list sorting. */
  async setActiveTask(id: TaskId | string | null): Promise<void> {
    const next = id === null ? null : String(id)
    if (next && this.store.get(next)?.deletion) throw new TaskDeletingError(next)
    this.activeTaskAcc.set(next)
    if (next && this.store.get(next)) {
      // Global last-writer-wins, persisted eagerly so a restart reopens on it
      // regardless of the lazy recency flush below.
      writeLastActiveTaskId(next)
      // Not `store.update(next, {})`: an empty patch still does a full fsync'd
      // read-merge-write on every focus switch (the most frequent action).
      // `touchRecency` bumps `updatedAt` in-cache and notifies (so the `recent`
      // sort reorders live), flushing on the next real mutation.
      this.store.touchRecency(next)
    }
  }

  /** Observable state of the current task list. */
  tasksSignal(): ReadableState<Task[]> {
    return this.tasksAcc
  }

  /**
   * Fires once with the current snapshot when available (eagerly if the store
   * is loaded, else from its `load()`), then after every mutation.
   *
   * Must NOT also fire the listener directly: that double-publishes
   * `task.snapshot` on daemon boot, and throws before load (`list()` asserts loaded).
   */
  subscribeTasks(listener: TaskListListener): Unsubscribe {
    return this.store.subscribe(listener)
  }

  dispose(): void {
    this.unsubscribeStore()
  }

  // --- read ---

  listTasks(): Task[] {
    return this.store.list()
  }

  getTask(id: TaskId | string): Task | undefined {
    return this.store.get(id)
  }

  // --- write ---

  /** Create a new task row — body in `core-create.ts`. */
  createTask = (input: CreateTaskInput): Promise<Task> =>
    createTaskRow(
      {
        store: this.store,
        mainTasks: this.mainTasks,
        claimWorktreeName: (repo, name) => this.worktreeCoordinator.claimWorktreeName(repo, name),
      },
      input,
    )

  /** Open an existing directory as a standalone `kind:"dir"` task (`rove .`). */
  openDirectoryTask = (input: OpenDirectoryTaskInput): Promise<Task> =>
    openDirectoryTaskRow({ store: this.store }, input)

  /** Migrate a scratch task into a repo (adoption) — see `core-create.ts`. */
  adoptScratchRepo = (id: TaskId | string, repo: string): Promise<void> =>
    adoptScratchRepoRow({ store: this.store }, id, repo)

  /** Ensure the repo's `kind:"main"` sidebar row exists — see {@link MainTaskCoordinator.ensure}. */
  async ensureMainTask(repo: string): Promise<Task> {
    return await this.mainTasks.ensure(repo)
  }

  /**
   * Materialise the task's worktree; returns its path. Idempotent. If the
   * recorded dir vanished (a delete that didn't clear the index, a manual `rm`,
   * a crash mid-`deleteTask`), prune git's stale registration and re-materialise
   * onto the task's OWN branch, so committed work is recovered.
   */
  async ensureWorktree(id: TaskId | string): Promise<string> {
    const task = this.requireTask(id)
    if (task.deletion) throw new TaskDeletingError(String(task.id))
    if (task.kind === "main") return repoWorkingDir(task.repo)
    // A dir task pins a user-owned directory — never prune/re-materialise it.
    if (task.kind === "dir") return task.worktreePath
    if (task.worktreePath) {
      if (await this.worktrees.pathExists(task.worktreePath)) return task.worktreePath
      // Prune first, else `worktree add` on the same path errors.
      await this.worktrees.pruneWorktrees(task.repo)
      await this.store.update(task.id, { worktreePath: "" })
      return this.worktreeCoordinator.ensure({ ...task, worktreePath: "" })
    }
    return this.worktreeCoordinator.ensure(task)
  }

  /**
   * Clear a task's `worktreePath` (keeping its branch) after an out-of-band
   * worktree removal — the next enter re-materialises onto the retained branch
   * instead of spawning into a dead dir. No-op if already unlinked.
   */
  async clearWorktreePath(id: TaskId | string): Promise<void> {
    const task = this.store.get(id)
    if (!task || !task.worktreePath) return
    // Only a Rove-created worktree is ours to forget: a `dir` task's path IS the
    // user's directory (blanking it makes `ensureWorktree` return "" for good),
    // a `main` task's is the checkout.
    if (task.kind === "main" || task.kind === "dir") return
    await this.store.update(task.id, { worktreePath: "" })
    this.worktreeCoordinator.forget(task.id)
  }

  // Pure forwarding to TaskEditor; the rules are documented on its methods.

  setTitle = (id: TaskId | string, title: string): Promise<void> => this.editor.setTitle(id, title)
  setBranch = (id: TaskId | string, branch: string): Promise<void> => this.editor.setBranch(id, branch)
  /** Record the language a task's user writes in, from their own prompt text. */
  observeLanguage = (id: TaskId | string, text: string): Promise<void> => this.editor.observeLanguage(id, text)
  setVendor = (id: TaskId | string, vendor: VendorId, effort?: string, model?: string): Promise<void> =>
    this.editor.setVendor(id, vendor, effort, model)
  setCommand = (id: TaskId | string, command: string, vendor?: VendorId): Promise<void> =>
    this.editor.setCommand(id, command, vendor)
  setPinned = (id: TaskId | string, pinned?: boolean): Promise<void> => this.editor.setPinned(id, pinned)
  moveTask = (id: TaskId | string, delta: -1 | 1): Promise<void> => this.editor.moveTask(id, delta)
  setStatus = (id: TaskId | string, status: TaskStatus): Promise<void> => this.editor.setStatus(id, status)

  /** Record the worker's own account of what it delivered — see
   *  {@link TaskEditor.setWorkerReport}. */
  setWorkerReport = (id: TaskId | string, report: Omit<TaskWorkerReport, "at">): Promise<void> =>
    this.editor.setWorkerReport(id, report)
  setPRStatus = (id: TaskId | string, prStatus: TaskPRStatus | null): Promise<void> =>
    this.editor.setPRStatus(id, prStatus)
  setLinkedWorkItem = (id: TaskId | string, item: NonNullable<Task["linkedWorkItem"]> | null): Promise<void> =>
    this.editor.setLinkedWorkItem(id, item)
  setQuotaResume = (id: TaskId | string, state: NonNullable<Task["quotaResume"]> | null): Promise<void> =>
    this.editor.setQuotaResume(id, state)
  /** Record the task brief (the delivered `add --prompt` text) on the task. */
  setPrompt = (id: TaskId | string, prompt: string): Promise<void> => this.editor.setPrompt(id, prompt)

  /**
   * Permanently remove a task. Refuses `kind: "main"` (remove the saved repo instead).
   *
   * Worktree safety: without `opts.force` a worktree with uncommitted /
   * untracked changes is NOT destroyed — throws {@link DirtyWorktreeError} so
   * the UI can re-prompt for force. If `git worktree remove` fails (locked /
   * permission / corrupt git-dir) throws {@link WorktreeRemoveFailedError} and
   * KEEPS the index entry, so the orphan stays visible and re-deletable. The
   * index entry is dropped only after the worktree is genuinely gone.
   */
  async deleteTask(id: TaskId | string, opts?: TaskDeletionOpts): Promise<void> {
    await this.deletions.deleteNow(id, opts)
  }

  /** Persist a deletion request after the normal safety checks. */
  async prepareTaskDeletion(id: TaskId | string, opts?: TaskDeletionOpts): Promise<boolean> {
    return this.deletions.prepare(id, opts)
  }

  /** Transition a queued/resumed deletion to running. */
  async beginTaskDeletion(id: TaskId | string): Promise<boolean> {
    return this.deletions.begin(id)
  }

  /** Execute physical cleanup and retain a visible error on failure. */
  async finishTaskDeletion(id: TaskId | string): Promise<void> {
    return this.deletions.finish(id)
  }

  /** Read-only "may this land, and into what": `landTask`'s pre-merge probes, nothing written. */
  async landPreflight(id: TaskId | string): Promise<LandPreflight> {
    const task = this.requireTask(id)
    if (task.kind === "main") throw new Error("landTask: a main task has no branch to land")
    if (task.kind === "dir") throw new Error("landTask: a directory task has no Rove-managed branch to land")
    if (task.deletion) throw new TaskDeletingError(String(task.id))
    return landPreflight(task)
  }

  /** Land a task's branch back into its base repo — executor + cleanup in `land.ts`. */
  async landTask(id: TaskId | string, opts?: LandTaskOpts): Promise<LandResult> {
    const task = this.requireTask(id)
    // Without it a land races the deletion runner.
    if (task.deletion) throw new TaskDeletingError(String(task.id))
    return landTaskWithCleanup(task, opts ?? {}, {
      worktrees: this.worktrees,
      clearWorktreePath: (tid) => this.clearWorktreePath(tid),
      tearDownSession: this.tearDownSession,
    })
  }

  /** Drop a saved project + its main row — see {@link MainTaskCoordinator.forget}. */
  async forgetProject(repo: string): Promise<void> {
    await this.mainTasks.forget(repo)
  }

  /**
   * Worktrees of `repo` on disk not yet linked to any task, including ones
   * outside the convention root. De-duped by canonical path so an adopted
   * worktree never reappears.
   */
  async discoverAdoptableWorktrees(repo: string): Promise<readonly AdoptableWorktree[]> {
    if (!repo) throw new Error("discoverAdoptableWorktrees: repo is required")
    return this.worktreeCoordinator.discoverAdoptable(repo)
  }

  /**
   * Adopt an existing git worktree as a new task, recording its real path +
   * branch so `ensureWorktree` never touches the filesystem. Validates it is a
   * real worktree of `repo` and not already a task.
   */
  async adoptWorktree(input: {
    readonly repo: string
    readonly worktreePath: string
    readonly branch?: string
    readonly vendor?: VendorId
    readonly title?: string
    /** When a task already tracks this worktree: `"error"` (default, `api adopt`)
     *  throws; `"return"` (WorktreeCreate hook) returns it, so a re-fired hook is a no-op. */
    readonly ifExists?: "error" | "return"
  }): Promise<Task> {
    if (!input.repo) throw new Error("adoptWorktree: repo is required")
    if (!input.worktreePath) throw new Error("adoptWorktree: worktreePath is required")
    return this.worktreeCoordinator.adopt(input)
  }

  // --- internals ---

  private requireTask(id: TaskId | string): Task {
    const task = this.store.get(id)
    if (!task) throw new TaskNotFoundError(String(id))
    return task
  }
}
