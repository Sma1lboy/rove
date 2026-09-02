/**
 * `kobe <path>` — the `code .` gesture: open a directory and land in the TUI
 * focused on it. What it opens depends on WHAT the directory is:
 *
 *   - **The root of an eligible git repo** → the project itself, i.e. the
 *     same outcome as `rove add . && rove`. Minting a throwaway `dir` row for
 *     a checkout you work in would put it beside the main row it is later
 *     promoted into, listing the same checkout twice under one header.
 *   - **Anything else** — a subdirectory, a plain folder, a `/tmp` scratch —
 *     → a standalone `kind:"dir"` task with NO project association: no saved
 *     repo, no main task, no worktree/branch. The task pins the directory
 *     itself, deleting it later only drops the index entry (the directory is
 *     never touched), and each invocation creates a NEW task, so the same
 *     directory twice is two parallel sessions with a random title suffix.
 *
 * Prefers a RUNNING daemon (live TUIs see the row immediately); falls back to
 * the in-process orchestrator, persisting focus for the daemon the TUI is
 * about to boot.
 */

import { statSync } from "node:fs"
import { resolve } from "node:path"
import { expandTilde } from "../lib/path-home.ts"
import { withDaemonOrLocal } from "./orchestrator-bridge.ts"
import { activeCliName } from "./rename-compat.ts"

/**
 * True when the first CLI arg is EXPLICIT path syntax (`kobe .`, `kobe ..`,
 * `kobe ./x`, `kobe /abs`, `kobe ~/x`) — the open-directory gesture.
 * Deliberately narrow: a bare word (`kobe statsu`) stays an unknown-command
 * error, never a directory guess.
 */
export function isPathLikeArg(arg: string): boolean {
  return (
    arg === "." ||
    arg === ".." ||
    arg.startsWith("./") ||
    arg.startsWith("../") ||
    arg.startsWith("/") ||
    arg === "~" ||
    arg.startsWith("~/")
  )
}

/**
 * Whether `dir` is the ROOT of a repo eligible to be a project. Only the
 * toplevel qualifies: running `rove .` inside `my-monorepo/packages/app`
 * should open a session there, not silently re-target the whole monorepo —
 * and a subdirectory that mints its own project row is a ghost project named
 * after a subdirectory.
 */
async function projectRootFor(dir: string): Promise<string | null> {
  const { isGitRepo, resolveRepoRoot } = await import("../state/repos.ts")
  const { projectRejection } = await import("../state/project-eligibility.ts")
  const top = resolveRepoRoot(dir)
  if (top !== dir) return null
  // `explicit`: the user typed this path, exactly as they would to `rove add`.
  // The stricter `derived` tier exists for repos Rove infers on its own, and
  // applying it here would refuse `rove .` in any checkout under /tmp.
  return projectRejection(top, isGitRepo, "explicit") ? null : top
}

export async function runOpenDirectory(arg: string): Promise<void> {
  const dir = resolve(process.cwd(), expandTilde(arg))
  let isDir = false
  try {
    isDir = statSync(dir).isDirectory()
  } catch {
    isDir = false
  }
  if (!isDir) {
    process.stderr.write(`${activeCliName()}: "${arg}" is not a directory (resolved to ${dir}).\n`)
    process.exit(1)
  }
  // A repo root opens AS THE PROJECT: `rove .` in a checkout you work in is
  // the same gesture as `rove add . && rove`, and a throwaway `dir` row would
  // sit beside the main row it is later promoted into, saying the same
  // checkout twice.
  // Anything else — a subdirectory, a non-repo folder, a `/tmp` scratch —
  // keeps the dir-task behaviour: pinned to that directory, no project row.
  const projectRoot = await projectRootFor(dir)
  await withDaemonOrLocal({
    daemon: async (client) => {
      let taskId: string
      if (projectRoot) {
        const res = await client.request<{ task: { id: string } }>("task.ensureMain", { repo: projectRoot })
        taskId = res.task.id
      } else {
        taskId = (await client.request<{ taskId: string }>("task.openDir", { dir })).taskId
      }
      await client.request("task.setActive", { taskId })
    },
    local: async (orch) => {
      const task = projectRoot ? await orch.ensureMainTask(projectRoot) : await orch.openDirectoryTask({ dir })
      const { writeLastActiveTaskId } = await import("../state/last-active.ts")
      writeLastActiveTaskId(String(task.id))
    },
  })
  const { publishKobeTerminalTitle } = await import("../tui/lib/outer-terminal-title.ts")
  publishKobeTerminalTitle()
  const { startTui } = await import("../tui/index.tsx")
  await startTui()
}
