/**
 * Landing a task that spans several repos: git cannot land atomically across
 * repos, so this probes every repo first (nothing is touched if one refuses),
 * merges in picked order (primary first), and stops at the first conflict. The
 * run is resumable: a repo already merged shows zero commits ahead, reports
 * `skipped`, and the re-run carries on with the rest.
 *
 * Worktrees are removed only once every selected repo is landed. The primary's
 * is the engine's cwd, so removing it after the first merge would pull the
 * directory from under a live session that still has a conflict to resolve in
 * a later repo.
 */

import type {
  LandPreflightResult,
  LandRepoPreflight,
  LandRepoResult,
  LandResult,
} from "@sma1lboy/rove-daemon/daemon/contracts"
import type { TaskRepoView } from "@sma1lboy/rove-daemon/task-tree"
import { errorMessage } from "../lib/error-message.ts"
import type { Task, TaskId } from "../types/task.ts"
import { LandConflictError } from "./errors.ts"
import { landPreflight, landRefusalError } from "./land-preflight.ts"
import { type LandDeps, type LandTaskOpts, finishLanded, landTask } from "./land.ts"
import { pickRepos } from "./task-tree.ts"
import { type WorktreeExecDeps, defaultExecDeps } from "./worktree/exec-deps.ts"

export interface LandAllDeps extends Omit<LandDeps, "clearWorktreePath" | "sharesWorktree"> {
  /** Forget one repo's worktree path on the row after its directory was removed. */
  readonly clearRepoWorktreePath: (id: TaskId | string, repoName: string) => Promise<void>
  /** True when another task runs in this repo's directory; a land then keeps it. */
  readonly sharesRepoWorktree: (task: Task, repo: TaskRepoView) => boolean
}

interface Probed {
  readonly repo: TaskRepoView
  readonly view: Task
  readonly row: LandRepoPreflight
}

/** The single-repo land functions read `repo/branch/worktreePath/baseRef` off a Task: project one repo onto it. */
function viewOf(task: Task, repo: TaskRepoView): Task {
  const { baseRef: _primaryBase, ...rest } = task
  return {
    ...rest,
    repo: repo.repo,
    branch: repo.branch,
    worktreePath: repo.worktreePath,
    ...(repo.baseRef ? { baseRef: repo.baseRef } : {}),
  }
}

function codeOf(message: string): string | undefined {
  return /^([A-Z][A-Z0-9_]{2,}): /.exec(message)?.[1]
}

async function probeOne(task: Task, repo: TaskRepoView, deps: WorktreeExecDeps): Promise<Probed> {
  const view = viewOf(task, repo)
  if (!repo.branch.trim()) {
    const row: LandRepoPreflight = {
      name: repo.name,
      status: "skipped",
      branch: "",
      landedOn: "",
      baseDir: repo.repo,
      message: "never materialised — nothing to land",
    }
    return { repo, view, row }
  }
  const pf = await landPreflight(view, deps)
  // A branch Rove landed and deleted (`--repo X --delete-branch`) no longer resolves; its worktree is gone too.
  if (pf.refusal === "MISSING_REF" && !repo.worktreePath.trim()) {
    const row: LandRepoPreflight = {
      ...pf,
      name: repo.name,
      status: "skipped",
      message: `branch '${pf.branch}' is gone and the worktree was already removed — landed earlier`,
    }
    return { repo, view, row }
  }
  // Zero commits ahead on a clean worktree is "already landed" (or untouched), not a refusal.
  const status = !pf.refusal ? "ready" : pf.refusal === "EMPTY_BRANCH" ? "skipped" : "refused"
  return { repo, view, row: { ...pf, name: repo.name, status } }
}

async function probeAll(task: Task, only: string | undefined, deps: WorktreeExecDeps): Promise<Probed[]> {
  const probed: Probed[] = []
  for (const repo of pickRepos(task, only)) probed.push(await probeOne(task, repo, deps))
  return probed
}

/**
 * Read-only: every repo's probe, in picked order. The top-level fields are the
 * head repo's — the first refusal, else the first repo with commits to land — so
 * a caller that only reads the one-repo shape still gets the right answer.
 */
export async function landPreflightAll(
  task: Task,
  only?: string,
  deps: WorktreeExecDeps = defaultExecDeps,
): Promise<LandPreflightResult> {
  const rows = (await probeAll(task, only, deps)).map((p) => p.row)
  const head = rows.find((r) => r.status === "refused") ?? rows.find((r) => r.status === "ready") ?? rows[0]
  if (!head) throw new Error("landPreflight: task has no repos")
  const { name: _name, status: _status, ...top } = head
  const nothingToLand = rows.every((r) => r.status === "skipped")
  return { ...top, ...(nothingToLand && !top.refusal ? { refusal: "EMPTY_BRANCH" as const } : {}), repos: rows }
}

function pendingRow(p: Probed): LandRepoResult {
  const { row } = p
  if (row.status === "skipped") {
    // Not the one-repo "worker delivered nothing" copy: on a resume this repo is usually already landed.
    const reason =
      row.refusal === "EMPTY_BRANCH" ? `nothing ahead of ${row.landedOn} — already landed or untouched` : row.message
    return {
      name: row.name,
      status: "skipped",
      branch: row.branch,
      landedOn: row.landedOn,
      ...(reason ? { error: reason } : {}),
    }
  }
  return {
    name: row.name,
    status: "pending",
    branch: row.branch,
    landedOn: row.landedOn,
    ...(row.ahead === undefined ? {} : { ahead: row.ahead }),
  }
}

function summarise(
  strategy: LandResult["strategy"],
  results: readonly LandRepoResult[],
  stopped: LandResult["stopped"],
): LandResult {
  const lead = results.find((r) => r.status === "landed") ?? results.find((r) => r.status === "refused") ?? results[0]
  return {
    branch: lead?.branch ?? "",
    strategy,
    landedOn: lead?.landedOn ?? "",
    commit: lead?.commit ?? "",
    ...(lead?.worktree ? { worktree: lead.worktree } : {}),
    ...(lead?.branchAnchor ? { branchAnchor: lead.branchAnchor } : {}),
    ...(lead?.branchKept ? { branchKept: lead.branchKept } : {}),
    repos: results,
    ...(stopped ? { stopped } : {}),
  }
}

/**
 * Land every selected repo (all, or just `only`). A refusal in the probe or a
 * conflict in a merge does not throw: the result carries each repo's status and
 * `stopped`, so the caller sees what already landed. Throws only when there is
 * nothing to land anywhere, the same refusal a one-repo land gives.
 */
export async function landTaskAll(
  task: Task,
  opts: LandTaskOpts,
  deps: LandAllDeps,
  only?: string,
): Promise<LandResult> {
  const strategy = opts.strategy ?? "merge"
  const probed = await probeAll(task, only, defaultExecDeps)
  const results = probed.map(pendingRow)

  const refused = probed.findIndex((p) => p.row.status === "refused")
  if (refused >= 0) {
    const { row } = probed[refused] as Probed
    const code = row.refusal ?? "REFUSED"
    const message = row.message ?? code
    results[refused] = { ...results[refused], name: row.name, status: "refused", code, error: message }
    return summarise(strategy, results, { repo: row.name, code, message })
  }
  if (!probed.some((p) => p.row.status === "ready")) {
    const first = probed.find((p) => p.row.refusal)
    if (first?.row.refusal) throw landRefusalError(first.view, { ...first.row, refusal: first.row.refusal })
    throw new Error("landTask: task has no branch to land (never materialised)")
  }

  let stopped: LandResult["stopped"]
  for (const [i, p] of probed.entries()) {
    if (p.row.status !== "ready" || stopped) continue
    try {
      const merged = await landTask(p.view, { strategy })
      results[i] = {
        name: p.repo.name,
        status: "landed",
        branch: merged.branch,
        landedOn: merged.landedOn,
        commit: merged.commit,
        ...(p.row.ahead === undefined ? {} : { ahead: p.row.ahead }),
      }
    } catch (err) {
      const message = errorMessage(err)
      const conflict = err instanceof LandConflictError
      const code = conflict ? "LAND_CONFLICT" : (codeOf(message) ?? "LAND_FAILED")
      results[i] = {
        name: p.repo.name,
        status: conflict ? "conflict" : "failed",
        branch: p.row.branch,
        landedOn: p.row.landedOn,
        code,
        error: message,
      }
      stopped = { repo: p.repo.name, code, message }
    }
  }
  if (stopped) return summarise(strategy, results, stopped)

  // Every selected repo is landed: now the worktrees and (opt-in) branches can go.
  // Landing one named repo must not pull the primary (the engine's cwd) while other repos still have worktrees.
  const selected = new Set(probed.map((p) => p.repo.name))
  const othersOpen = only !== undefined && pickRepos(task).some((r) => !selected.has(r.name) && r.worktreePath.trim())
  for (const [i, p] of probed.entries()) {
    const row = results[i] as LandRepoResult
    if (!p.repo.branch.trim() || (row.status !== "landed" && row.status !== "skipped")) continue
    // Landed and removed earlier (branch deleted, worktree gone): nothing left to clean.
    if (row.status === "skipped" && p.row.refusal === "MISSING_REF") continue
    if (p.repo.primary && othersOpen) {
      const reason = "kept until every repo has landed: other repos of this task still have worktrees"
      results[i] = {
        ...row,
        worktree: { removed: false, reason },
        ...(opts.deleteBranch ? { branchKept: { reason } } : {}),
      }
      continue
    }
    const repoDeps: LandDeps = {
      worktrees: deps.worktrees,
      // Only the primary is the engine's cwd; an extra's removal leaves the session running.
      tearDownSession: p.repo.primary ? deps.tearDownSession : undefined,
      clearWorktreePath: (id) => deps.clearRepoWorktreePath(id, p.repo.name),
      sharesWorktree: () => deps.sharesRepoWorktree(task, p.repo),
    }
    const done = await finishLanded(
      p.view,
      { branch: p.row.branch, strategy, landedOn: p.row.landedOn, commit: row.commit ?? "" },
      opts,
      repoDeps,
    )
    results[i] = {
      ...row,
      ...(done.worktree && p.view.worktreePath ? { worktree: done.worktree } : {}),
      ...(done.branchAnchor ? { branchAnchor: done.branchAnchor } : {}),
      ...(done.branchKept ? { branchKept: done.branchKept } : {}),
    }
  }
  return summarise(strategy, results, undefined)
}
