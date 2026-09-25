/**
 * Bob Shell workspace trust. A first launch in an unseen directory stops on
 * "Do you trust this folder?" (options "1. Trust folder", "2. Trust parent
 * folder", "3. Don't trust") — a dialog no hosted session can answer, and a
 * parallel round would open one per sibling. The worktree comes from a repo
 * the user already runs sessions in, so pre-accepting is the same trust
 * domain as for claude/codex/kimi/copilot.
 *
 * The store is `~/.bob/trustedFolders.json`:
 * `{ "version": 1, "folders": { "<absolute path>": "TRUST_FOLDER" } }`.
 * Verified against bob 2.0.5: launching with `--trust` in an untrusted
 * directory writes exactly that entry, and a pre-written one boots straight
 * to the composer.
 *
 * The catalog entry ALSO passes `--trust`. This hook is the primary, because
 * it still protects a user who replaced the launch command; `--trust` is the
 * backstop for when this best-effort write fails.
 */

import { homedir } from "node:os"
import { updateSharedJsonSync } from "../shared-config-write.ts"
import { bobTrustPath } from "../vendor-home.ts"

const TRUSTED = "TRUST_FOLDER"

export function trustBobWorktree(worktreePath: string, home: string = homedir()): void {
  updateSharedJsonSync(
    bobTrustPath(home),
    (raw) => {
      if (raw === undefined) return {}
      try {
        return JSON.parse(raw) as Record<string, unknown>
      } catch {
        // Corrupt — start empty rather than refuse to launch, as claude's does.
        return {}
      }
    },
    (doc) => {
      const folders = (doc.folders ?? {}) as Record<string, unknown>
      if (folders[worktreePath] === TRUSTED) return undefined
      const merged = { ...doc, version: doc.version ?? 1, folders: { ...folders, [worktreePath]: TRUSTED } }
      return `${JSON.stringify(merged, null, 2)}\n`
    },
  )
}
