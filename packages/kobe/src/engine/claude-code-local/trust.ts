/**
 * Claude Code workspace trust (issue #28). Claude gates a first launch in a
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

import { homedir } from "node:os"
import path from "node:path"
import { updateSharedJsonSync } from "../shared-config-write.ts"

export function trustClaudeWorktree(worktreePath: string, home: string = homedir()): void {
  updateSharedJsonSync(
    path.join(home, ".claude.json"),
    (raw) => {
      if (raw === undefined) return {}
      try {
        return JSON.parse(raw) as Record<string, unknown>
      } catch {
        // Corrupt — start from an empty doc; that is claude's own recovery
        // behavior too (it rewrites the file wholesale on every save).
        return {}
      }
    },
    (doc) => {
      const projects = { ...((doc.projects as Record<string, unknown> | undefined) ?? {}) }
      const existing = (projects[worktreePath] ?? {}) as Record<string, unknown>
      if (existing.hasTrustDialogAccepted === true) return undefined
      projects[worktreePath] = { ...existing, hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
      return JSON.stringify({ ...doc, projects }, null, 2)
    },
  )
}
