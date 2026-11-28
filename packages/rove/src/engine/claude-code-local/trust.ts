/**
 * Pre-accept Claude's "trust this folder?" dialog for a task worktree: a
 * hosted session can't answer it, and the worktree comes from a repo the user
 * already trusts. Store: `~/.claude.json` →
 * `projects[<abspath>].hasTrustDialogAccepted`. MERGE, never clobber (entries
 * hold allowedTools, MCP choices), under the compare-and-swap in
 * `../shared-config-write.ts` since claude rewrites the file wholesale —
 * read its module doc before changing the write.
 */

import { existsSync, lstatSync } from "node:fs"
import path from "node:path"
import { isObject } from "@sma1lboy/rove-core/lib/is-object.ts"
import { realPathOrSelf } from "../../lib/real-path.ts"
import { updateSharedJsonSync } from "../shared-config-write.ts"
import { claudeGlobalConfigPath, vendorConfigHome, vendorWriteHomeDeps } from "../vendor-home.ts"

export function trustClaudeWorktree(worktreePath: string, home?: string): void {
  const resolved = realPathOrSelf(worktreePath)
  const project = process.platform === "win32" ? resolved.replaceAll("\\", "/") : resolved
  const deps = vendorWriteHomeDeps(home)
  const current = claudeGlobalConfigPath(deps.env, deps.home())
  const legacy = path.join(vendorConfigHome("claude", deps), ".config.json")
  const stat = lstatSync(legacy, { throwIfNoEntry: false })
  if (stat?.isSymbolicLink()) throw new Error("Refusing to replace a symlinked Claude config")
  // Claude still prefers a populated legacy store, even when the newer file exists.
  const useLegacy = stat?.isFile() && (stat.size > 0 || ((stat.mode & 0o222) !== 0 && !existsSync(current)))
  updateSharedJsonSync(
    useLegacy ? legacy : current,
    (raw) => {
      if (raw === undefined) return {}
      const doc: unknown = JSON.parse(raw)
      if (!isObject(doc)) throw new Error("Claude trust config must be a JSON object")
      return doc
    },
    (doc) => {
      if (doc.projects !== undefined && !isObject(doc.projects)) {
        throw new Error("Claude trust projects must be an object")
      }
      const projects = { ...doc.projects }
      const existing = Object.hasOwn(projects, project) ? projects[project] : {}
      if (!isObject(existing)) throw new Error("Claude trust project must be an object")
      if (existing.hasTrustDialogAccepted === true) return undefined
      projects[project] = { ...existing, hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
      return JSON.stringify({ ...doc, projects }, null, 2)
    },
  )
}
