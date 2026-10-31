/** In-place task-field setters for the {@link Orchestrator}: each a small
 *  guard around one `store` mutation (branch renames also touch git). */

import { samePath } from "@sma1lboy/rove-daemon/path-identity"
import { detectLanguage } from "@sma1lboy/rove-daemon/prompts/observed-language"
import { samePrStatus } from "../monitor/pr-status.ts"
import type {
  Task,
  TaskId,
  TaskLinkedWorkItem,
  TaskPRStatus,
  TaskQuotaResumeState,
  TaskStatus,
  TaskWorkerReport,
  VendorId,
} from "../types/task.ts"
import { deriveConventionBranch, inferBranchStyle, uniqueBranchName } from "./branch-style.ts"
import { IllegalTransitionError, TaskNotFoundError } from "./errors.ts"
import type { TaskIndexStore } from "./index/store.ts"
import { isPlaceholderDerivedBranch, sanitizeTaskTitle } from "./title.ts"
import type { GitWorktreeManager } from "./worktree/manager.ts"

export class TaskEditor {
  private readonly store: TaskIndexStore
  private readonly worktrees: GitWorktreeManager

  constructor(store: TaskIndexStore, worktrees: GitWorktreeManager) {
    this.store = store
    this.worktrees = worktrees
  }

  private requireTask(id: TaskId | string): Task {
    const task = this.store.get(id)
    if (!task) throw new TaskNotFoundError(String(id))
    return task
  }

  /** Naming a SCRATCH task is the "keep this" gesture: clears the flag so the
   *  row survives its shell exiting. An automatic name passes `keepScratch`. */
  async setTitle(id: TaskId | string, title: string, opts?: { keepScratch?: boolean }): Promise<void> {
    const trimmed = sanitizeTaskTitle(title)
    if (!trimmed) throw new Error("setTitle: title is required (empty or whitespace-only rejected)")
    const task = this.requireTask(id)
    const unscratch = task.scratch === true && opts?.keepScratch !== true
    if (task.title === trimmed && !unscratch) return
    await this.store.update(task.id, { title: trimmed, ...(unscratch ? { scratch: false } : {}) })
    await this.followBranchToTitle(task, trimmed)
  }

  /**
   * Rename the branch to follow the title while it's still the
   * placeholder-derived default (`new-task`, or legacy `rove/`/`rove/`), so a
   * prompt-auto-named task gets a real branch. Fires at most once: after that
   * the branch no longer matches, so later titles / manual `setBranch` are
   * never clobbered. Skipped for `main` and unmaterialised tasks
   * (`ensureWorktree` derives theirs from the title).
   *
   * Best-effort — failures are logged, never thrown (the title already
   * committed; the placeholder stays):
   *   - never rename a branch with an upstream (would orphan the remote / PR);
   *     an unreadable probe also keeps the name;
   *   - a local collision gets a `-2`, `-3`… suffix.
   */
  private async followBranchToTitle(taskBefore: Task, newTitle: string): Promise<void> {
    if (taskBefore.kind === "main" || !taskBefore.worktreePath) return
    if (!isPlaceholderDerivedBranch(taskBefore.branch, taskBefore.id)) return
    try {
      const names = await this.worktrees.listBranchNames(taskBefore.repo)
      const base = deriveConventionBranch(newTitle, inferBranchStyle(names), taskBefore.id)
      if (base === taskBefore.branch) return
      if (await this.worktrees.branchHasUpstream(taskBefore.worktreePath, taskBefore.branch)) return
      // Exclude the source so it can't force its own successor to `-2`.
      const taken = new Set(names.filter((n) => n !== taskBefore.branch))
      const nextBranch = uniqueBranchName(base, taken, taskBefore.id)
      await this.setBranch(taskBefore.id, nextBranch)
    } catch (err) {
      console.error(`[rove] follow-branch-to-title failed for ${taskBefore.id}:`, err)
    }
  }

  /**
   * Materialised: `git branch -m` (moves HEAD too, so a running session keeps
   * streaming). Unmaterialised: records the name for `ensureWorktree`.
   * Rejected for `main`/`dir`, which track their checkout's own branch.
   */
  async setBranch(id: TaskId | string, branch: string): Promise<void> {
    const trimmed = branch.trim()
    if (!trimmed) throw new Error("setBranch: branch is required (empty or whitespace-only rejected)")
    const task = this.requireTask(id)
    if (task.kind === "main") {
      throw new Error("setBranch: a main task tracks the repo's own branch; rename it with git directly")
    }
    if (task.kind === "dir") {
      throw new Error("setBranch: a directory task tracks its own checkout; rename branches with git directly")
    }
    if (task.branch === trimmed) return
    // Every repo of a multi-repo task still on the shared name renames with it, or none does.
    const extras = (task.extraRepos ?? []).filter((x) => x.worktreePath && x.branch === task.branch)
    const renamed: { path: string; from: string }[] = []
    try {
      if (task.worktreePath) {
        await this.worktrees.renameBranch(task.worktreePath, task.branch, trimmed)
        renamed.push({ path: task.worktreePath, from: task.branch })
      }
      for (const extra of extras) {
        await this.worktrees.renameBranch(extra.worktreePath, extra.branch, trimmed)
        renamed.push({ path: extra.worktreePath, from: extra.branch })
      }
    } catch (err) {
      for (const done of renamed.reverse())
        await this.worktrees.renameBranch(done.path, trimmed, done.from).catch(() => {})
      throw err
    }
    await this.store.update(task.id, {
      branch: trimmed,
      ...(task.extraRepos
        ? { extraRepos: task.extraRepos.map((x) => (extras.includes(x) ? { ...x, branch: trimmed } : x)) }
        : {}),
    })
    // Sharers copy the owner's branch string; the rename moved it for every row in the directory.
    if (!task.worktreePath) return
    for (const holder of this.store.list()) {
      if (holder.id === task.id || holder.kind !== "task" || holder.branch !== task.branch) continue
      if (holder.worktreePath && samePath(holder.worktreePath, task.worktreePath)) {
        await this.store.update(holder.id, { branch: trimmed })
      }
    }
  }

  /**
   * On the prompt delivery path: writes only when the answer changes. No-opinion
   * text (`detectLanguage` → null) is ignored so an "ok" can't erase what a
   * paragraph established.
   */
  async observeLanguage(id: TaskId | string, text: string): Promise<void> {
    const observed = detectLanguage(text)
    if (!observed) return
    const task = this.requireTask(id)
    if (task.observedLanguage === observed) return
    await this.store.update(task.id, { observedLanguage: observed })
  }

  /**
   * Pure metadata; the next fresh engine session uses it. `effort` and `model`
   * are tri-state: `undefined` keeps, `""` clears (engine default), else sets —
   * otherwise a codex task could never go back off `xhigh`. "Keeps" holds only
   * on the same engine: a switch clears an unpassed pin, since another engine's
   * model would launch as `claude --model gpt-5-codex`. The same-vendor early
   * return must not swallow an effort/model-only change.
   */
  async setVendor(id: TaskId | string, vendor: VendorId, effort?: string, model?: string): Promise<void> {
    const task = this.requireTask(id)
    const switching = task.vendor !== vendor
    const effortArg = effort ?? (switching ? "" : undefined)
    const modelArg = model ?? (switching ? "" : undefined)
    const nextEffort = effortArg?.trim() ? effortArg.trim() : undefined
    const effortChanges = effortArg !== undefined && task.modelEffort !== nextEffort
    const nextModel = modelArg?.trim() ? modelArg.trim() : undefined
    const modelChanges = modelArg !== undefined && task.model !== nextModel
    if (!switching && !effortChanges && !modelChanges) return
    await this.store.update(task.id, {
      vendor,
      ...(effortArg !== undefined ? { modelEffort: nextEffort } : {}),
      ...(modelArg !== undefined ? { model: nextModel } : {}),
    })
  }

  /**
   * Pin a RAW launch command (`update --command`); metadata like {@link setVendor}.
   * `vendor` is the protocol the caller resolved from the preset registry;
   * omitted leaves the recorded one rather than guessing. A vendor change
   * clears the model/effort pins, as in {@link setVendor}.
   */
  async setCommand(id: TaskId | string, command: string, vendor?: VendorId): Promise<void> {
    const trimmed = command.trim()
    if (!trimmed) throw new Error("setCommand: command is required (empty or whitespace-only rejected)")
    const task = this.requireTask(id)
    const switching = vendor !== undefined && task.vendor !== vendor
    if (task.command === trimmed && !switching) return
    await this.store.update(task.id, {
      command: trimmed,
      ...(switching ? { vendor, model: undefined, modelEffort: undefined } : {}),
    })
  }

  /** No-op for `main` (always pinned). */
  async setPinned(id: TaskId | string, pinned?: boolean): Promise<void> {
    const task = this.requireTask(id)
    if (task.kind === "main") return
    const next = pinned ?? !task.pinned
    if ((task.pinned ?? false) === next) return
    await this.store.update(task.id, { pinned: next })
  }

  /** A project's `main` checkout is the project itself: never archived. */
  async setArchived(id: TaskId | string, archived: boolean): Promise<void> {
    const task = this.requireTask(id)
    if (task.kind === "main") throw new Error("a project's main checkout cannot be archived")
    if ((task.archived ?? false) === archived) return
    await this.store.update(task.id, { archived: archived || undefined })
  }

  /** Hold every later send to this task to a `rove api report` (`false` clears). */
  async setRequireReport(id: TaskId | string, required: boolean): Promise<void> {
    const task = this.requireTask(id)
    if ((task.requireReport ?? false) === required) return
    await this.store.update(task.id, { requireReport: required || undefined })
  }

  /**
   * Within the visible partition: mains among mains (store order IS project
   * order); tasks within their repo (a cross-repo swap would be invisible or
   * jump groups) and pinned flag. Edge-stop, never wrap.
   */
  async moveTask(id: TaskId | string, delta: -1 | 1): Promise<void> {
    const task = this.requireTask(id)
    await this.store.move(task.id, delta, this.movePartition(task))
  }

  /** {@link moveTask} to the head of the same partition; a main = project to the top. */
  async moveTaskToTop(id: TaskId | string): Promise<void> {
    const task = this.requireTask(id)
    await this.store.moveToFront(task.id, this.movePartition(task))
  }

  private movePartition(task: Task): string[] {
    const isMain = task.kind === "main"
    return this.store
      .list()
      .filter((t) =>
        isMain
          ? (t.kind ?? "task") === "main"
          : (t.kind ?? "task") !== "main" &&
            samePath(t.repo, task.repo) &&
            (t.pinned ?? false) === (task.pinned ?? false),
      )
      .map((t) => String(t.id))
  }

  /** Transitions are user-driven, not enforced, except `done` ↔ `error`
   *  flip-flops are refused to surface bad code. */
  async setStatus(id: TaskId | string, status: TaskStatus): Promise<void> {
    const task = this.requireTask(id)
    if (task.status === status) return
    if ((task.status === "done" && status === "error") || (task.status === "error" && status === "done")) {
      throw new IllegalTransitionError(task.status, status, task.id)
    }
    await this.store.update(task.id, { status })
  }

  /**
   * What the WORKER says it delivered (`update --report-*`). Separate from
   * {@link setStatus}, whose unchanged-status early return would drop the
   * common re-report on an already-`done` task. Fields MERGE onto the previous
   * report; `at` always restamps ("last reported").
   */
  async setWorkerReport(id: TaskId | string, report: Omit<TaskWorkerReport, "at">): Promise<void> {
    const task = this.requireTask(id)
    const next: TaskWorkerReport = { ...task.report, ...report, at: new Date().toISOString() }
    await this.store.update(task.id, { report: next })
  }

  /**
   * From `pr-status-collector`; `null` clears. On the Task so the snapshot push
   * fans it out and it survives restarts. No-op when nothing rendered changed.
   * `lastError` is compared separately: `samePrStatus` omits it (so a healthy
   * PR doesn't write every tick), but the chip renders it, and without this
   * check it could never be set or cleared.
   */
  async setPRStatus(id: TaskId | string, prStatus: TaskPRStatus | null, repoName?: string): Promise<void> {
    const task = this.requireTask(id)
    const extra = repoName ? task.extraRepos?.find((x) => x.name === repoName) : undefined
    if (repoName && !extra) return
    const current = extra ? extra.prStatus : task.prStatus
    const sameError = (current?.lastError ?? null) === (prStatus?.lastError ?? null)
    if (sameError && samePrStatus(current, prStatus ?? undefined)) return
    if (!extra) {
      await this.store.update(task.id, { prStatus: prStatus ?? undefined })
      return
    }
    // A repo's own PR rides its entry; re-read the list so a concurrent worktree write isn't clobbered.
    const latest = this.store.get(task.id)?.extraRepos ?? []
    await this.store.update(task.id, {
      extraRepos: latest.map((x) => (x.name === repoName ? { ...x, prStatus: prStatus ?? undefined } : x)),
    })
  }

  /** Rate-limit auto-resume schedule; `null` clears. No-op when unchanged: the
   *  sweep and the hook path may both write. */
  async setQuotaResume(id: TaskId | string, state: TaskQuotaResumeState | null): Promise<void> {
    const task = this.requireTask(id)
    if ((task.quotaResume?.resumeAt ?? null) === (state?.resumeAt ?? null)) return
    await this.store.update(task.id, { quotaResume: state ?? undefined })
  }

  /** Stamp the external tracker item this task was started from. Write-once in
   *  practice (set at creation); a later call overwrites the snapshot. */
  async setLinkedWorkItem(id: TaskId | string, item: TaskLinkedWorkItem | null): Promise<void> {
    const task = this.requireTask(id)
    if ((task.linkedWorkItem?.url ?? null) === (item?.url ?? null)) return
    await this.store.update(task.id, { linkedWorkItem: item ?? undefined })
  }

  /** The `add --prompt` brief, verbatim, so it outlives a dead engine's
   *  transcript. No-op when unchanged. */
  async setPrompt(id: TaskId | string, prompt: string): Promise<void> {
    if (prompt.trim().length === 0) throw new Error("setPrompt: prompt is required (empty or whitespace-only rejected)")
    const task = this.requireTask(id)
    if (task.prompt === prompt) return
    await this.store.update(task.id, { prompt })
  }
}
