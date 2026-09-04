/**
 * Framework-free Task and Worktree orchestrator. It owns lifecycle metadata,
 * lazy Worktree allocation, and the reactive snapshot clients subscribe to.
 * Interactive engine processes and Terminal Tab state have separate owners.
 */

import { type ReadableState, type StateCell, createStateCell } from "../lib/external-store.ts"
import { readLastActiveTaskId, writeLastActiveTaskId } from "../state/last-active.ts"
import { getRemoteRepoConfig, getSavedRepos, removeSavedRepo } from "../state/repos.ts"
import { isGitRepo, resolveRepoRoot } from "../state/repos.ts"
import { resolvePreferredVendor } from "../state/vendor-prefs.ts"
import type {
  Task,
  TaskDispatcher,
  TaskId,
  TaskPRStatus,
  TaskRoutineLink,
  TaskStatus,
  VendorId,
} from "../types/task.ts"
import { DEFAULT_TASK_VENDOR } from "../types/task.ts"
import type { AdoptableWorktree } from "../types/worktree.ts"
import { type OpenDirectoryTaskInput, adoptScratchRepoRow, createTaskRow, openDirectoryTaskRow } from "./core-create.ts"
import { canonPath, repoWorkingDir } from "./core-helpers.ts"
import type { CreateTaskInput } from "./create-task-input.ts"
import { DirtyWorktreeError, TaskDeletingError, TaskNotFoundError, WorktreeRemoveFailedError } from "./errors.ts"
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

// The create-task input type lives in its own module so it can be imported
// without importing this class. Re-exported here so callers still name it
// through the orchestrator.
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
  readonly onSalvage?: (taskId: TaskId, salvage: { readonly ref: string; readonly commit: string }) => void
  /** Called when a deletion's `git worktree remove` deregistered the worktree
   *  but could not delete its directory. The deletion still completes; this is
   *  the only record of the leftover, so the daemon binds it to the same audit
   *  log the rest of the deletion trail goes to. */
  readonly onWorktreeResidue?: (taskId: TaskId, residue: { readonly path: string; readonly reason: string }) => void
  /**
   * Kill a task's engine session. Bound by the composition root to the hosted
   * session host; a TUI-local orchestrator leaves it unset. `landTask` calls
   * it before removing a landed worktree — an engine still writing into a
   * directory that is about to be unlinked loses everything it writes next.
   */
  readonly tearDownSession?: (taskId: TaskId | string) => Promise<void>
}

// Re-exported from `title.ts` (its single source of truth) so existing
// importers of `PLACEHOLDER_TASK_TITLE` from `core.ts` keep working.
export { PLACEHOLDER_TASK_TITLE }

/**
 * Owner of the task lifecycle.
 *
 * Single source of truth for: which tasks exist, which worktree each
 * lives in, what its status / pinned flag is. The TUI
 * subscribes via {@link tasksSignal} or {@link subscribeTasks}.
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
    )
    this.tasksAcc = createStateCell<Task[]>(this.store.list())
    // Seed focus from the persisted `lastActive` record (state/last-active
    // .ts) so a daemon restart or fresh TUI opens on the last-focused task
    // instead of "first in the list". Dropped silently when the task is
    // gone (deleted since) — the UI's own fallback picks a survivor.
    const persistedFocus = readLastActiveTaskId()
    this.activeTaskAcc = createStateCell<string | null>(
      persistedFocus && this.store.get(persistedFocus) ? persistedFocus : null,
    )
    this.unsubscribeStore = this.store.subscribe((snapshot) => {
      this.tasksAcc.set(snapshot.slice())
    })
  }

  /**
   * Pre-flight hook for the TUI to await before the first render.
   *
   * One job: absorb `dir` rows that are sitting on a repository root into
   * that repo's `main` row. `rove .` routes a repo root to `ensureMainTask`,
   * so nothing new lands mis-shaped — but a `dir` row already on disk renders
   * as a bare path, outside every behaviour written for a project row
   * (ordering, pin, the fold on a closed last tab). `ensure` only runs when
   * somebody names the repo, so without a sweep those rows stay wrong forever.
   *
   * Best-effort by construction: it runs before the first frame, and a repo
   * that has moved or a git that will not answer must not stop the TUI from
   * starting. `ensureIfEligible` reuses the same admission gate and the same
   * adoption branch as every other caller — the promoted row keeps its task
   * id, so its terminal tabs come with it.
   */
  async init(): Promise<void> {
    try {
      const promotable = promotableDirTasks({
        tasks: this.store.list(),
        isRepoRoot: (path) => isGitRepo(path) && resolveRepoRoot(path) === path,
      })
      for (const task of promotable) await this.mainTasks.ensureIfEligible(task.repo, "explicit")
    } catch {
      // A promotion that cannot happen is a row that renders the way it did
      // yesterday, not a boot failure.
    }
  }

  /**
   * The active-task focus, in-process. Mirrors {@link RemoteOrchestrator}'s
   * daemon-backed `active-task` channel so the `KobeOrchestrator` union has
   * one API; in this local (no-daemon) mode there are no sibling panes to
   * sync, so it's just an in-process signal.
   */
  activeTaskSignal(): ReadableState<string | null> {
    return this.activeTaskAcc
  }

  /** Set the active-task focus and touch recency for task-list sorting. */
  async setActiveTask(id: TaskId | string | null): Promise<void> {
    const next = id === null ? null : String(id)
    if (next && this.store.get(next)?.deletion) throw new TaskDeletingError(next)
    this.activeTaskAcc.set(next)
    if (next && this.store.get(next)) {
      // Global last-writer-wins focus record — see state/last-active.ts. This
      // eagerly persists the ONE last-focused id, so a daemon/TUI restart
      // reopens on it regardless of the lazy recency flush below.
      writeLastActiveTaskId(next)
      // Recency bump for the sidebar's `recent` sort ONLY. Deliberately NOT a
      // `store.update(next, {})`: that empty patch still ran a full fsync'd
      // read-merge-write on every focus switch (the single most frequent
      // action) to move `updatedAt`, which the DEFAULT sort never reads.
      // `touchRecency` bumps `updatedAt` in-cache + notifies listeners (so
      // `recent` reorders live) but flushes lazily on the next real mutation —
      // dropping the per-switch fsync'd disk rewrite + full-list broadcast churn.
      this.store.touchRecency(next)
    }
  }

  /** Observable state of the current task list. */
  tasksSignal(): ReadableState<Task[]> {
    return this.tasksAcc
  }

  /**
   * Subscribe to task-list updates. Fires once with the current snapshot as
   * soon as it's available — eagerly here if the store is already loaded, else
   * from the store's own `load()` notification — then again after every
   * mutation.
   *
   * We must NOT also fire the listener directly: the store already delivers
   * that first snapshot (eagerly on subscribe when loaded, via load() otherwise).
   * A direct fire on top double-published `task.snapshot` on daemon boot, and on
   * the not-yet-loaded path it threw (the store's `list()` asserts loaded).
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

  /**
   * Create a new task row — body in `core-create.ts`. Row minting is the one
   * cluster here that is not already a coordinator delegation, so it is where
   * this file splits; the class stays the thin delegator its doc claims.
   */
  createTask = (input: CreateTaskInput): Promise<Task> =>
    createTaskRow({ store: this.store, mainTasks: this.mainTasks }, input)

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
   * Materialise the worktree on disk for `task`. Idempotent: if the recorded
   * worktree still exists, fast-path it. If the recorded dir vanished (a UI/web
   * delete that didn't clear the index, a manual `rm`, a crash mid-`deleteTask`),
   * self-heal: prune git's stale registration, drop the dead path, and
   * re-materialise onto the task's OWN branch — committed work recovered, not a
   * permanently-dead task. Returns the worktree path.
   */
  async ensureWorktree(id: TaskId | string): Promise<string> {
    const task = this.requireTask(id)
    if (task.deletion) throw new TaskDeletingError(String(task.id))
    if (task.kind === "main") return repoWorkingDir(task.repo)
    // A dir task pins a user-owned directory — never prune/re-materialise it.
    if (task.kind === "dir") return task.worktreePath
    if (task.worktreePath) {
      if (await this.worktrees.pathExists(task.worktreePath)) return task.worktreePath
      // Recorded path is gone: prune git's dangling registration (else `worktree
      // add` on the same path errors), clear the dead pointer, re-materialise.
      await this.worktrees.pruneWorktrees(task.repo)
      await this.store.update(task.id, { worktreePath: "" })
      return this.worktreeCoordinator.ensure({ ...task, worktreePath: "" })
    }
    // Lazy materialise via the coordinator; the short-circuits above read the
    // task index, not the worktree side, so they stay here.
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
    // Only a Rove-created worktree is ours to forget: a `dir` task's path IS
    // the user's directory (blanking it makes `ensureWorktree` return "" for
    // good), a `main` task's is the checkout, and `handlers-worktree.ts`
    // matches both by exact path.
    if (task.kind === "main" || task.kind === "dir") return
    await this.store.update(task.id, { worktreePath: "" })
    this.worktreeCoordinator.forget(task.id)
  }

  // In-place task-field edits (title / branch / engine / pinned / status /
  // PR-status / move) live in the TaskEditor collaborator.
  // Terse one-liners below on purpose: they are PURE forwarding, so anything
  // written here would be a second copy of a rule that lives on TaskEditor's
  // own methods — read them there. Same shape `remote-orchestrator.ts` uses
  // for its own write delegates.

  setTitle = (id: TaskId | string, title: string): Promise<void> => this.editor.setTitle(id, title)
  setBranch = (id: TaskId | string, branch: string): Promise<void> => this.editor.setBranch(id, branch)
  /** Record the language a task's user writes in, from their own prompt text. */
  observeLanguage = (id: TaskId | string, text: string): Promise<void> => this.editor.observeLanguage(id, text)
  setVendor = (id: TaskId | string, vendor: VendorId, effort?: string): Promise<void> =>
    this.editor.setVendor(id, vendor, effort)
  setCommand = (id: TaskId | string, command: string, vendor?: VendorId): Promise<void> =>
    this.editor.setCommand(id, command, vendor)
  setPinned = (id: TaskId | string, pinned?: boolean): Promise<void> => this.editor.setPinned(id, pinned)
  moveTask = (id: TaskId | string, delta: -1 | 1): Promise<void> => this.editor.moveTask(id, delta)
  setStatus = (id: TaskId | string, status: TaskStatus): Promise<void> => this.editor.setStatus(id, status)
  setPRStatus = (id: TaskId | string, prStatus: TaskPRStatus | null): Promise<void> =>
    this.editor.setPRStatus(id, prStatus)
  setLinkedWorkItem = (id: TaskId | string, item: NonNullable<Task["linkedWorkItem"]> | null): Promise<void> =>
    this.editor.setLinkedWorkItem(id, item)
  setQuotaResume = (id: TaskId | string, state: NonNullable<Task["quotaResume"]> | null): Promise<void> =>
    this.editor.setQuotaResume(id, state)
  /** Record the task brief (the delivered `add --prompt` text) on the task. */
  setPrompt = (id: TaskId | string, prompt: string): Promise<void> => this.editor.setPrompt(id, prompt)

  /**
   * Permanently remove a task. Refuses to delete `kind: "main"`
   * tasks (the user removes the repo from saved repos instead).
   *
   * Worktree safety: without `opts.force` a worktree with
   * uncommitted / untracked changes is NOT destroyed — we throw
   * {@link DirtyWorktreeError} so the UI can re-prompt for explicit
   * force confirmation. And if `git worktree remove` itself fails
   * (locked / permission / corrupt git-dir) we throw
   * {@link WorktreeRemoveFailedError} and KEEP the index entry, so the
   * orphaned worktree stays visible + re-deletable instead of becoming
   * invisible on-disk debris. The index entry is dropped only after the
   * worktree is genuinely gone.
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

  /**
   * Read-only "may this land, and into what" — the same probes `landTask` runs
   * before its merge, with nothing written. Behind the land confirm's
   * destination + commit count and `rove api land --dry-run`.
   */
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
    // The refusal every other worktree entry point makes (`setActiveTask`,
    // `ensureWorktree`): without it a land races the deletion runner.
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
   * Discover git worktrees on `repo` that exist on disk but aren't yet
   * linked to any task — candidates for adoption. Includes
   * worktrees outside the kobe convention root (the user's own
   * `git worktree add`). De-dupes against the task store by canonical
   * path so an already-adopted worktree never reappears.
   */
  async discoverAdoptableWorktrees(repo: string): Promise<readonly AdoptableWorktree[]> {
    if (!repo) throw new Error("discoverAdoptableWorktrees: repo is required")
    return this.worktreeCoordinator.discoverAdoptable(repo)
  }

  /**
   * Adopt an existing git worktree as a new task. The worktree
   * already exists on disk, so we record the task with its real path +
   * branch directly — `ensureWorktree` then short-circuits (non-empty
   * `worktreePath`) and never touches the filesystem. Validates the path
   * is a real worktree of `repo` and isn't already a task. The dedupe lock +
   * validation + main-task provisioning live in the coordinator.
   */
  async adoptWorktree(input: {
    readonly repo: string
    readonly worktreePath: string
    readonly branch?: string
    readonly vendor?: VendorId
    readonly title?: string
    /**
     * What to do when a task already tracks this worktree. `"error"` (default,
     * the user-facing `kobe api adopt` path) throws; `"return"` (the
     * WorktreeCreate hook path) returns the existing task, making sync
     * idempotent — a re-fired hook or a worktree kobe already owns is a no-op.
     */
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
