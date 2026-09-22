import { statSync } from "node:fs"
import { auditWorktreeResidue, auditWorktreeSalvaged } from "@sma1lboy/kobe-daemon/daemon/task-deletion-audit"
import { execHostForWorktreePath } from "../exec/resolve.ts"
import { GitWorktreeManager } from "../orchestrator/worktree/manager.ts"
import { type PrState, judgeWorktree, parseGhPrList } from "../orchestrator/worktree/staleness.ts"
import { getRemoteRepoConfig, getSavedRepos } from "../state/repos.ts"
import type { WorktreeAuditRow, WorktreeProject } from "../types/worktree.ts"

const TIMEOUT_MS = 4_000
const manager = new GitWorktreeManager()

function createdAt(path: string): number {
  try {
    const stat = statSync(path)
    return stat.birthtimeMs || stat.mtimeMs
  } catch {
    return 0
  }
}

async function run(path: string, argv: readonly string[]) {
  return execHostForWorktreePath(path).run(argv, { cwd: path, signal: AbortSignal.timeout(TIMEOUT_MS) })
}

async function branchOnRemote(path: string, branch: string): Promise<boolean | null> {
  try {
    const out = await run(path, ["git", "ls-remote", "--exit-code", "--heads", "origin", branch])
    return out.exitCode === 0 ? true : out.exitCode === 2 ? false : null
  } catch {
    return null
  }
}

async function defaultRef(repo: string): Promise<string | null> {
  try {
    const out = await run(repo, ["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
    if (out.exitCode === 0 && out.stdout.trim()) return out.stdout.trim()
  } catch {}
  for (const guess of ["origin/main", "origin/master"]) {
    try {
      if ((await run(repo, ["git", "rev-parse", "--verify", "--quiet", guess])).exitCode === 0) return guess
    } catch {}
  }
  return null
}

async function prStates(repo: string): Promise<ReadonlyMap<string, PrState> | null> {
  try {
    const origin = await run(repo, ["git", "remote", "get-url", "origin"])
    if (origin.exitCode !== 0 || !origin.stdout.includes("github.com")) return null
    const out = await run(repo, ["gh", "pr", "list", "--state", "all", "--limit", "200", "--json", "headRefName,state"])
    return out.exitCode === 0 ? parseGhPrList(out.stdout) : null
  } catch {
    return null
  }
}

async function ahead(path: string, ref: string | null): Promise<number | null> {
  if (!ref) return null
  try {
    const out = await run(path, ["git", "rev-list", "--count", `${ref}..HEAD`])
    const value = Number.parseInt(out.stdout.trim(), 10)
    return out.exitCode === 0 && !Number.isNaN(value) ? value : null
  } catch {
    return null
  }
}

export async function listWorktreeProjectsAdapter(network: boolean): Promise<WorktreeProject[]> {
  const repos = getSavedRepos().filter((repo) => !getRemoteRepoConfig(repo))
  const now = Date.now()
  return Promise.all(
    repos.map(async (repo) => {
      const [worktrees, states, ref] = await Promise.all([
        manager.listAll(repo),
        network ? prStates(repo) : null,
        defaultRef(repo),
      ])
      const rows = await Promise.all(
        worktrees.map(async (worktree): Promise<WorktreeAuditRow> => {
          const [remote, aheadBy] = await Promise.all([
            network ? branchOnRemote(worktree.path, worktree.branch) : null,
            ahead(worktree.path, ref),
          ])
          const judgement = judgeWorktree(
            {
              // Unreadable reads as not-dirty for staleness only. Safe: removal
              // calls `isDirty` UNCAUGHT (`manager-remove.ts`) and throws; the
              // row still carries the honest `null`.
              dirty: worktree.dirty === true,
              prState: states?.get(worktree.branch) ?? null,
              aheadOfDefault: aheadBy,
              lastActivityMs: worktree.lastActivityMs,
            },
            now,
          )
          return {
            ...worktree,
            repo,
            createdAtMs: createdAt(worktree.path),
            branchOnRemote: remote,
            verdict: judgement.verdict,
            verdictReason: judgement.reason,
          }
        }),
      )
      return { repo, worktrees: rows }
    }),
  )
}

/** Admin dirs `git worktree list` silently omitted (`unreadableWorktreeNames`),
 *  so an empty `discover-adoptable` never hides an unreadable worktree. */
export async function listUnreadableWorktreesAdapter(repo: string): Promise<readonly string[]> {
  return manager.listUnreadableWorktrees(repo)
}

/**
 * The daemon runtime's `removeWorktree`. A force retry reuses a `row` captured
 * before the dirty refusal, so the tree may hold work the confirm never
 * described; `manager.remove` salvages it first and this records where.
 */
export async function removeWorktreeAdapter(
  path: string,
  force: boolean,
): Promise<{ path: string; reason: string } | null> {
  let residue: { path: string; reason: string } | null = null
  await manager.remove(path, {
    force,
    onSalvage: (record) => {
      if (record) auditWorktreeSalvaged(path, record.ref, record.commit, record.uncaptured)
    },
    // Deregistered but directory left behind: not a failure (a retry would be
    // fatal), but logged — nothing in Rove lists that path again.
    onResidue: (r) => {
      residue = { path: r.path, reason: r.reason }
      auditWorktreeResidue(r.path, r.reason)
    },
  })
  return residue
}
