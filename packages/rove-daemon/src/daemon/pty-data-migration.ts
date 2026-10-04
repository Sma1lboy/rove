import { preRenameStateDir } from "./pre-rename-runtime.ts"
/** Move host-owned exit records and frozen sessions at the single-writer host boot boundary. */

import { existsSync, lstatSync, mkdirSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"

/** PTY-host-owned entries: the exit store (file) and the freeze store (dir). */
const PTY_HOST_DATA_ENTRIES = ["pty-exits.json", "pty-sessions"] as const

function lstatIfExists(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

/**
 * Best-effort by contract: a failed move leaves the legacy entry in place and
 * the host boots with an empty store rather than not booting at all.
 */
export function migrateLegacyPtyHostData(homeDir = readRoveHomeDirEnv() ?? homedir()): readonly string[] {
  const canonicalDir = join(homeDir, ROVE_STATE_DIR_BASENAME)
  const legacyDir = preRenameStateDir(homeDir)
  if (canonicalDir === legacyDir) return []
  const moved: string[] = []
  for (const name of PTY_HOST_DATA_ENTRIES) {
    const canonical = join(canonicalDir, name)
    const legacy = join(legacyDir, name)
    try {
      // Idempotent: an already-moved canonical entry short-circuits here.
      if (existsSync(canonical)) continue
      const stat = lstatIfExists(legacy)
      // A legacy symlink is our leftover to a since-deleted canonical entry;
      // renaming it would install a self-referential link.
      if (!stat || stat.isSymbolicLink()) continue
      mkdirSync(canonicalDir, { recursive: true })
      renameSync(legacy, canonical)
      moved.push(name)
    } catch {
      /* unreadable or cross-device home: leave the legacy entry where it is */
    }
  }
  return moved
}
