/**
 * Copilot CLI workspace trust. A first launch in a new directory shows a
 * "Confirm folder trust" dialog (cursor on session-only "1. Yes"; "2. Yes, and
 * remember this folder" below) that a hosted session can't answer. The
 * worktree comes from a repo the user already runs sessions in, so
 * pre-accepting is the same trust domain — as for claude/codex/kimi.
 *
 * The store is `<COPILOT_HOME>/config.json` (default `~/.copilot/config.json`)
 * → `trustedFolders`, an array of absolute paths. Verified against Copilot CLI
 * v1.0.82: answering "remember this folder" appends the path there, and a
 * pre-written entry boots straight to the prompt with no dialog.
 *
 * Two wrinkles the siblings do not have:
 *
 *   - The file is JSONC: copilot writes a two-line `//` header ("User settings
 *     belong in settings.json. / This file is managed automatically."), so
 *     `JSON.parse` throws. The header is stripped to parse and replayed
 *     verbatim on write.
 *   - Copilot rewrites the whole document on its own saves (the `~/.claude.json`
 *     race) — hence `updateSharedJsonSync`; read its doc before changing this.
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
  // Per call, not module-level: a retry re-runs load, so the header always
  // matches the bytes this attempt merges onto.
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
        // Corrupt — start empty, as claude's trust does; copilot rewrites the
        // file wholesale on every save anyway.
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
