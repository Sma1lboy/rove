/**
 * `<path>` — the `code .` gesture: open a directory and land in the TUI on it.
 *
 * Always a new `kind:"dir"` session in that directory: no worktree, and
 * deleting it only drops the index entry. The root of an eligible git repo is
 * also saved as a project (as `rove add .` does), so the session sits under it.
 *
 * Prefers a RUNNING daemon; falls back to the in-process orchestrator,
 * persisting focus for the daemon the TUI is about to boot.
 */

import { statSync } from "node:fs"
import { resolve } from "node:path"
import { expandTilde } from "@sma1lboy/rove-core/lib/path-home.ts"
import { ROVE_PRODUCT_NAME } from "@sma1lboy/rove-core/product.ts"
import { pathSyntax } from "@sma1lboy/rove-daemon/path-identity"

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
  const { isGitRepo, resolveRepoRoot } = await import("@sma1lboy/rove-core/state/repos.ts")
  const { projectRejection } = await import("@sma1lboy/rove-core/state/project-eligibility.ts")
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
    process.stderr.write(`${ROVE_PRODUCT_NAME}: "${arg}" is not a directory (resolved to ${dir}).\n`)
    process.exit(1)
  }
  // A repo root is saved as a project too (see header).
  const projectRoot = await projectRootFor(dir)
  const { withDaemonOrLocal } = await import("./orchestrator-bridge.ts")
  await withDaemonOrLocal({
    daemon: async (client) => {
      const at = projectRoot
        ? (await client.request<{ repo: string }>("project.ensure", { repo: projectRoot })).repo
        : dir
      const { taskId } = await client.request<{ taskId: string }>("task.openDir", { dir: at })
      await client.request("task.setActive", { taskId })
    },
    local: async (orch) => {
      const task = await orch.openDirectoryTask({ dir: projectRoot ? await orch.ensureProject(projectRoot) : dir })
      const { writeLastActiveTaskId } = await import("../state/last-active.ts")
      writeLastActiveTaskId(String(task.id))
    },
  })
  const { publishRoveTerminalTitle } = await import("../tui/lib/outer-terminal-title.ts")
  publishRoveTerminalTitle()
  const { launchTui } = await import("./launch-tui.ts")
  await launchTui()
}
