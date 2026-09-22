/**
 * `<path>` — the `code .` gesture: open a directory and land in the TUI on it.
 *
 *   - **Root of an eligible git repo** → the project itself (same as
 *     `rove add . && rove`). A `dir` row would duplicate the checkout beside
 *     the main row it later gets promoted into.
 *   - **Anything else** → a standalone `kind:"dir"` task: no saved repo, main
 *     task, or worktree. Deleting it only drops the index entry; each
 *     invocation creates a NEW task.
 *
 * Prefers a RUNNING daemon; falls back to the in-process orchestrator,
 * persisting focus for the daemon the TUI is about to boot.
 */

import { statSync } from "node:fs"
import { resolve } from "node:path"
import { pathSyntax } from "@sma1lboy/kobe-daemon/path-identity"
import { expandTilde } from "../lib/path-home.ts"
import { withDaemonOrLocal } from "./orchestrator-bridge.ts"
import { activeCliName } from "./rename-compat.ts"

/**
 * True for EXPLICIT path syntax (`.`, `..`, `./x`, `/abs`, `~/x`). Narrow on
 * purpose: a bare word (`statsu`) stays an unknown-command error.
 */
export function isPathLikeArg(arg: string): boolean {
  return (
    arg === "." ||
    arg === ".." ||
    arg.startsWith("./") ||
    arg.startsWith("../") ||
    arg.startsWith(".\\") ||
    arg.startsWith("..\\") ||
    pathSyntax(arg).isAbsolute(arg) ||
    arg.startsWith("/") ||
    arg === "~" ||
    arg.startsWith("~/") ||
    arg.startsWith("~\\")
  )
}

/**
 * `dir` if it is the ROOT of an eligible repo. Only the toplevel: `rove .`
 * in `monorepo/packages/app` must not re-target the whole monorepo.
 */
async function projectRootFor(dir: string): Promise<string | null> {
  const { isGitRepo, resolveRepoRoot } = await import("../state/repos.ts")
  const { projectRejection } = await import("../state/project-eligibility.ts")
  const top = resolveRepoRoot(dir)
  if (top !== dir) return null
  // `explicit`: the user typed the path. `derived` (for inferred repos) would
  // refuse `rove .` in any checkout under /tmp.
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
  // Repo root → the project; anything else → a dir task (see header).
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
