/**
 * Copilot CLI workspace trust. Copilot gates a first launch in a never-seen
 * directory behind a "Confirm folder trust" dialog whose cursor sits on
 * "1. Yes" — session-only, so it comes back every launch — with
 * "2. Yes, and remember this folder for future sessions" one row below. A
 * hosted session can answer neither, so a Rove worktree without pre-trust sits
 * at the dialog. Rove created that worktree from a repo the user already runs
 * sessions in; pre-accepting is the same trust domain and the only
 * headless-viable answer, exactly as for claude/codex/kimi.
 *
 * The store is `<COPILOT_HOME>/config.json` (default `~/.copilot/config.json`)
 * → `trustedFolders`, an array of absolute paths. Verified against Copilot CLI
 * v1.0.82: answering "remember this folder" appends the path there, and a
 * pre-written entry boots straight to the prompt with no dialog.
 *
 * Two wrinkles the siblings do not have:
 *
 *   - The file is JSONC. Copilot writes a two-line `//` header ("User settings
 *     belong in settings.json. / This file is managed automatically."), so a
 *     plain `JSON.parse` throws on a config copilot itself wrote. The header is
 *     stripped to parse and replayed verbatim on write, so the note copilot
 *     puts there for the user survives our merge.
 *   - Copilot rewrites the whole document on its own saves, which is the same
 *     race `~/.claude.json` has — hence `updateSharedJsonSync`. Read that
 *     module's doc before changing this write.
 */

import { homedir } from "node:os"
import { updateSharedJsonSync } from "../shared-config-write.ts"
import { copilotConfigPath } from "../vendor-home.ts"

/** Leading `//` lines (and blanks) copilot puts above the JSON body. Only the
 *  header is treated as comments — `//` inside the body would be inside a
 *  string, where stripping it would corrupt a path. */
function splitJsoncHeader(raw: string): { header: string; body: string } {
  const lines = raw.split("\n")
  let i = 0
  while (i < lines.length && (lines[i].trim().startsWith("//") || lines[i].trim() === "")) i++
  return { header: lines.slice(0, i).join("\n"), body: lines.slice(i).join("\n") }
}

export function trustCopilotWorktree(worktreePath: string, home: string = homedir()): void {
  // Carried from load to build so the JSON we emit stays JSONC-shaped the way
  // copilot wrote it. Per call, not module-level: a retry re-runs load first,
  // so the header always matches the bytes this attempt is merging onto.
  let carriedHeader = ""
  updateSharedJsonSync(
    copilotConfigPath((name) => process.env[name], home),
    (raw) => {
      carriedHeader = ""
      if (raw === undefined) return {}
      const { header, body } = splitJsoncHeader(raw)
      carriedHeader = header
      try {
        return JSON.parse(body) as Record<string, unknown>
      } catch {
        // Corrupt — start from an empty doc, as claude's trust does. Copilot
        // rewrites this file wholesale on every save, so it recovers the same
        // way.
        return {}
      }
    },
    (doc) => {
      const existing = Array.isArray(doc.trustedFolders) ? (doc.trustedFolders as unknown[]) : []
      if (existing.some((entry) => entry === worktreePath)) return undefined
      const merged = { ...doc, trustedFolders: [...existing, worktreePath] }
      const body = JSON.stringify(merged, null, 2)
      return carriedHeader ? `${carriedHeader}\n${body}\n` : `${body}\n`
    },
  )
}
