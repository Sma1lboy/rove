/**
 * The "resolve these conflicts" engine prompt for a worktree whose merge,
 * rebase, cherry-pick or revert stopped on a conflict (a conflicted "Sync with
 * base" leaves its merge in place on purpose). `pausedGitOperation` is sync so
 * the row menu can gate on it at open time; it reads only a few marker files.
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { readOnlyGitProcessEnv } from "@/lib/git-env"
import { recordSpawn } from "@/lib/spawn-profile"
import { spawnCapture } from "../lib/background-poll"

export type PausedGitOperation = "merge" | "rebase" | "cherry-pick" | "revert"

const GIT_TIMEOUT_MS = 10_000

/** A linked worktree's `.git` is a `gitdir: <path>` file; a main checkout's is the dir itself. */
function gitDirOf(worktree: string): string | null {
  const dotGit = join(worktree, ".git")
  try {
    if (statSync(dotGit).isDirectory()) return dotGit
    const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))
    if (!match?.[1]) return null
    const dir = match[1].trim()
    return isAbsolute(dir) ? dir : resolve(worktree, dir)
  } catch {
    return null
  }
}

/** The git operation paused in `worktree`, or null. Rebase is checked first:
 *  a stopped rebase step can also leave a CHERRY_PICK_HEAD or MERGE_HEAD. */
export function pausedGitOperation(worktree: string): PausedGitOperation | null {
  if (worktree === "") return null
  const gitDir = gitDirOf(worktree)
  if (!gitDir) return null
  const has = (name: string) => existsSync(join(gitDir, name))
  if (has("rebase-merge") || (has("rebase-apply") && !has("rebase-apply/applying"))) return "rebase"
  if (has("CHERRY_PICK_HEAD")) return "cherry-pick"
  if (has("REVERT_HEAD")) return "revert"
  if (has("MERGE_HEAD")) return "merge"
  return null
}

/** Unmerged paths, or null when git could not be asked. */
export async function conflictedPaths(worktree: string): Promise<string[] | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GIT_TIMEOUT_MS)
  const args = ["diff", "--name-only", "--diff-filter=U"]
  try {
    recordSpawn("tui.conflictPrompt", ["git", ...args], worktree)
    const out = await spawnCapture("git", args, {
      cwd: worktree,
      env: readOnlyGitProcessEnv(),
      signal: controller.signal,
    })
    if (controller.signal.aborted || out.status !== 0) return null
    return out.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } finally {
    clearTimeout(timer)
  }
}

export interface ConflictPromptState {
  readonly operation: PausedGitOperation
  readonly branch: string
  readonly files: readonly string[]
}

// `GIT_EDITOR=true`: the engine's shell has no one to answer a message editor.
const CONTINUE_COMMAND: Record<PausedGitOperation, string> = {
  merge: "git commit --no-edit",
  rebase: "GIT_EDITOR=true git rebase --continue",
  "cherry-pick": "GIT_EDITOR=true git cherry-pick --continue",
  revert: "GIT_EDITOR=true git revert --continue",
}

function filesSentence(files: readonly string[]): string {
  if (files.length === 0)
    return "Git reports no unmerged files left, so the conflicts may already be resolved but not yet committed."
  return `The conflicted files are:\n\n${files.map((file) => `- ${file}`).join("\n")}`
}

export function buildConflictPrompt(state: ConflictPromptState): string {
  const op = state.operation
  return `A git ${op} is paused in this worktree on conflicts, and the user wants it finished.

The current branch is ${state.branch}.
${filesSentence(state.files)}

Follow these steps:

- Read both sides of each conflict, and the commits that made them, before editing. Keep the intent of both changes, not just one side.
- Remove every conflict marker, then run the project's checks that cover the files you touched.
- Stage the resolved files and finish with \`${CONTINUE_COMMAND[op]}\`. If the ${op} stops on another conflict, repeat.
- If a conflict needs a decision only the user can make, stop and ask rather than picking a side.

Do not abort the ${op} or reset the branch unless the user asks.`
}
