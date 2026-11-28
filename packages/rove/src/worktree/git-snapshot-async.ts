/**
 * `git-snapshot.ts`'s three questions without blocking the caller: for a long-lived server (the
 * web bridge), where a synchronous git held every browser's terminal frames and pushes for its
 * 30 ms a call. The answers are read by the same functions, so both say the same thing.
 */

import { execFile } from "node:child_process"
import { recordSpawn } from "@/lib/spawn-profile"
import { type GitAnswer, branchOf, branchesOf, isUnborn, pathProblem, repoProblem } from "./git-snapshot"

function git(repo: string, args: readonly string[]): Promise<GitAnswer> {
  recordSpawn("bridge.gitSnapshot", ["git", ...args], repo)
  return new Promise((resolve) => {
    execFile("git", [...args], { cwd: repo, encoding: "utf-8", timeout: 2000 }, (error, stdout) => {
      const code = (error as (Error & { code?: unknown }) | null)?.code
      resolve({
        status: error ? (typeof code === "number" ? code : 1) : 0,
        stdout: stdout ?? "",
        missing: code === "ENOENT",
        spawned: true,
      })
    })
  })
}

export async function validateRepoPath(repo: string): Promise<string | null> {
  const trimmed = repo.trim()
  const early = pathProblem(trimmed)
  if (early !== undefined) return early
  const [repoCheck, head] = await Promise.all([
    git(trimmed, ["rev-parse", "--git-dir"]),
    git(trimmed, ["rev-parse", "--verify", "HEAD"]),
  ])
  return repoProblem(trimmed, repoCheck, () => isUnborn(head))
}

export async function getCurrentBranch(repo: string): Promise<string | null> {
  return repo ? branchOf(await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])) : null
}

export async function listLocalBranches(repo: string): Promise<string[]> {
  return repo ? branchesOf(await git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"])) : []
}
