/**
 * One-shot synchronous git snapshots for task-creation surfaces. Kept out of
 * `new-task-dialog/state.ts` so the state machine stays pure, and so ONLY this
 * file carries the sync-subprocess whitelist entry in
 * `test/tui/render-path-sync-guard.test.ts`.
 *
 * Sync is tolerated because every call is one O(refs) git invocation fired by
 * an explicit dialog action (open, repo-field edit, `kobe quick-task`
 * defaults), never a render tick or poll. O(refs) scales with branch count, so
 * even a 30GB repo stays in low milliseconds. Anything periodic or O(repo
 * size) goes through `lib/background-poll.ts` or async spawn; do NOT grow this
 * module that way.
 */

import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import { recordSpawn } from "@/lib/spawn-profile"
import { t } from "@/tui/i18n"

/** Default base ref when the user leaves the branch field blank or HEAD can't be read. */
export const DEFAULT_BASE_REF = "main"

/**
 * A task is `git worktree + engine session + branch`, so the source must be a
 * repo. Explain and hand over the fix instead of leaking git's `fatal: not a
 * git repository`. Rendered word-wrapped.
 */
function notAGitRepoReason(path: string): string {
  return `This folder isn't a git repository yet, and a task needs a git branch to work in. To fix it, turn ${path} into a repo:  git init && git add -A && git commit -m "init"  — then create the task again. (Working in non-git folders is coming soon.)`
}

/**
 * Separate from {@link notAGitRepoReason} because `spawnSync` reports both as a
 * non-zero status, and suggesting `git init …` to a machine without git is
 * three `command not found`s. Same wording as WelcomePane's probe so one
 * machine can't show two diagnoses.
 */
function gitMissingReason(): string {
  return t("workspace.welcome.gitMissing")
}

function isBinaryMissing(out: { error?: Error & { code?: string } }): boolean {
  return out.error !== undefined && (out.error as { code?: string }).code === "ENOENT"
}

/**
 * The ONLY `spawnSync`, in the exact shape the sync-guard whitelist grants:
 * one shot, O(refs), 2s cap, stderr discarded. `missing` splits ENOENT out of a
 * non-zero exit; `spawned` is false when the spawn threw, which
 * {@link hasNoCommits} must not read as git's answer.
 */
function git(
  repo: string,
  args: readonly string[],
): { status: number; stdout: string; missing: boolean; spawned: boolean } {
  try {
    recordSpawn("tui.gitSnapshot", ["git", ...args], repo)
    const out = spawnSync("git", args, {
      cwd: repo,
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    })
    return { status: out.status ?? 1, stdout: out.stdout ?? "", missing: isBinaryMissing(out), spawned: true }
  } catch {
    return { status: 1, stdout: "", missing: false, spawned: false }
  }
}

/**
 * UNBORN HEAD (`git init`, no commit): passes the repo check and prefills
 * `DEFAULT_BASE_REF`, then fails in `ensureWorktree` as `fatal: invalid
 * reference: main` behind an invisible console.error. Catch it in the dialog.
 */
function noCommitsReason(path: string): string {
  return `This repository has no commits yet, and a task branches off an existing commit. To fix it, make one in ${path}:  git add -A && git commit -m "init"  — then create the task again.`
}

/**
 * PRECONDITION: `repo` is a git repo (`rev-parse --verify HEAD` also fails for
 * a non-repo). Private for that reason; {@link validateRepoPath} checks first.
 */
function hasNoCommits(repo: string): boolean {
  const out = git(repo, ["rev-parse", "--verify", "HEAD"])
  return out.spawned && !out.missing && out.status !== 0
}

/**
 * Null when usable, else a reason the dialog renders inline while blocking
 * submit, so a typo isn't persisted as `lastNewTaskRepo` to fail every later
 * `git worktree add`. A missing path is not created (almost always a typo).
 */
export function validateRepoPath(repo: string): string | null {
  const trimmed = repo.trim()
  if (!trimmed) return "repo path is required"
  let stat: fs.Stats
  try {
    stat = fs.statSync(trimmed)
  } catch {
    return `path does not exist: ${trimmed}`
  }
  if (!stat.isDirectory()) return `not a directory: ${trimmed}`
  const repoCheck = git(trimmed, ["rev-parse", "--git-dir"])
  if (repoCheck.missing) return gitMissingReason()
  if (repoCheck.status !== 0) return notAGitRepoReason(trimmed)
  // Unborn HEAD: nothing for `git worktree add <path> <baseRef>` to branch from.
  if (hasNoCommits(trimmed)) return noCommitsReason(trimmed)
  return null
}

/**
 * Prefills baseRef with the real current branch, so a worktree forked from a
 * feature branch doesn't silently default to main. Null for non-repo, detached
 * HEAD, or error.
 */
export function getCurrentBranch(repo: string): string | null {
  if (!repo) return null
  const out = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (out.status !== 0) return null
  const name = out.stdout.trim()
  return !name || name === "HEAD" ? null : name
}

/** Default branches first. [] on any error, so the picker degrades to free text. */
export function listLocalBranches(repo: string): string[] {
  if (!repo) return []
  const out = git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
  if (out.status !== 0) return []
  return out.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => {
      const score = (n: string) => (n === "main" ? 0 : n === "master" ? 1 : n === "develop" ? 2 : 3)
      const sa = score(a)
      const sb = score(b)
      if (sa !== sb) return sa - sb
      return a.localeCompare(b)
    })
}
