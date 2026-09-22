/**
 * Launch-path reader of the field-note store (docs/design/dispatcher.md); the
 * daemon is the only writer. Sync because `buildEngineSessionLaunch` is. A
 * missing/corrupt store is "no notes": this must never block a session start.
 * Matches on `repoRoot` (the daemon writes the main worktree there, same as a
 * task's `repo`) rather than re-deriving the git-common-dir key.
 */

import { readFileSync, realpathSync } from "node:fs"
import { join } from "node:path"
import { roveStateDir } from "../env.ts"

/** How many of the newest notes a fresh session is seeded with. */
export const NOTE_INJECTION_CAP = 15

export interface StoredFieldNote {
  /** Optional: the raw file may predate ids (`note.list` backfills them), and
   *  injection must not drop those notes. */
  readonly id?: number
  readonly at: string
  readonly text: string
  readonly taskId: string
  readonly author: string
}

function fieldNotesPath(): string {
  return join(roveStateDir(), "notes.json")
}

/** Resolve symlinks so `/var` vs `/private/var` can't split one repo in two. */
function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * Newest-first notes for `repoRoot`, capped at {@link NOTE_INJECTION_CAP}.
 * Empty for an unknown repo, an absent store, or anything unreadable.
 */
export function readFieldNotes(repoRoot: string, path = fieldNotesPath()): readonly StoredFieldNote[] {
  if (!repoRoot) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return []
  }
  const repos = (parsed as { repos?: Record<string, unknown> } | null)?.repos
  if (!repos || typeof repos !== "object") return []
  const target = canonical(repoRoot)
  for (const record of Object.values(repos)) {
    if (!record || typeof record !== "object") continue
    const typed = record as { repoRoot?: unknown; notes?: unknown }
    if (typeof typed.repoRoot !== "string" || canonical(typed.repoRoot) !== target) continue
    if (!Array.isArray(typed.notes)) return []
    return typed.notes
      .filter(
        (n): n is StoredFieldNote => !!n && typeof n === "object" && typeof (n as StoredFieldNote).text === "string",
      )
      .slice(0, NOTE_INJECTION_CAP)
  }
  return []
}
