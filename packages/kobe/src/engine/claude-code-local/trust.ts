/**
 * Claude Code workspace trust. Claude gates a first launch in a
 * never-seen directory behind a "Do you trust the files in this folder?"
 * dialog; a Rove task worktree is always such a directory, so a hosted
 * session would sit at the dialog forever. Rove created the worktree from a
 * repo the user already drives sessions in — pre-accepting trust for it is
 * the same trust domain, and the only headless-viable answer.
 *
 * The store is `~/.claude.json` → `projects[<abspath>].hasTrustDialogAccepted`
 * (existing entries also carry `hasCompletedProjectOnboarding`). MERGE, never
 * clobber: project entries accumulate per-project state (allowedTools, MCP
 * choices) that must survive — and claude itself rewrites this file wholesale
 * on every save, so the merge runs under the compare-and-swap in
 * `../shared-config-write.ts`. Read its module doc before changing the write.
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
