/**
 * Pre-accept Claude's "trust this folder?" dialog for a task worktree: a
 * hosted session can't answer it, and the worktree comes from a repo the user
 * already trusts. Store: `~/.claude.json` →
 * `projects[<abspath>].hasTrustDialogAccepted`. MERGE, never clobber (entries
 * hold allowedTools, MCP choices), under the compare-and-swap in
 * `../shared-config-write.ts` since claude rewrites the file wholesale —
 * read its module doc before changing the write.
 */

import { isObject } from "../json-hooks.ts"
import { updateSharedJsonSync } from "../shared-config-write.ts"
import { claudeGlobalConfigPath, vendorWriteHomeDeps } from "../vendor-home.ts"

export function trustClaudeWorktree(worktreePath: string, home?: string): void {
  const deps = vendorWriteHomeDeps(home)
  updateSharedJsonSync(
    claudeGlobalConfigPath(deps.env, deps.home()),
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
      const existing = Object.hasOwn(projects, worktreePath) ? projects[worktreePath] : {}
      if (!isObject(existing)) throw new Error("Claude trust project must be an object")
      if (existing.hasTrustDialogAccepted === true) return undefined
      projects[worktreePath] = { ...existing, hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
      return JSON.stringify({ ...doc, projects }, null, 2)
    },
  )
}
