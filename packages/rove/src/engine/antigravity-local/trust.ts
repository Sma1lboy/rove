/**
 * Antigravity CLI workspace trust. A first launch in an unseen directory asks
 * "Do you trust the contents of this project?", which a hosted session can't
 * answer. The worktree comes from a repo the user already runs sessions in, so
 * pre-accepting is the same trust domain, as for claude/codex/copilot.
 *
 * The store is `~/.gemini/antigravity-cli/settings.json` → `trustedWorkspaces`,
 * an array of absolute paths. Verified against agy 1.5.17: answering "Yes, I
 * trust this folder" appends the path there, and a pre-written entry boots
 * straight to the prompt.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { updateSharedJsonSync } from "../shared-config-write.ts"

export function trustAntigravityWorktree(worktreePath: string, home: string = homedir()): void {
  updateSharedJsonSync(
    join(home, ".gemini", "antigravity-cli", "settings.json"),
    (raw) => {
      if (raw === undefined) return {}
      try {
        return JSON.parse(raw) as Record<string, unknown>
      } catch {
        // The file also holds the user's settings: leave an unreadable one alone.
        return undefined
      }
    },
    (doc) => {
      const existing = Array.isArray(doc.trustedWorkspaces) ? (doc.trustedWorkspaces as unknown[]) : []
      if (existing.includes(worktreePath)) return undefined
      return `${JSON.stringify({ ...doc, trustedWorkspaces: [...existing, worktreePath] }, null, 2)}\n`
    },
  )
}
