/**
 * Move the PTY host's own data out of the legacy `.kobe` layout.
 *
 * `pty-exits.json` and `pty-sessions/` are the two state files the `.kobe` →
 * `.rove` move never carried across: they are deliberately absent from the
 * daemon-start copy list (`state/layout-migration.ts`) because a daemon
 * copying them would race the host that owns them. So they stayed put — and
 * the docs tell users a `~/.kobe` left behind after the rename is safe to
 * delete, which on such a home throws away every frozen session and every
 * engine-exit record.
 *
 * The PTY host's own boot is the single-writer moment for these paths: the
 * host is starting, no other process reads or writes them, and the freeze
 * store has not been opened yet. So the move happens here, once, and
 * `runtimeDataPath` in `paths.ts` can stay plain canonical afterwards.
 *
 * MOVED, not copied — a copy would leave two exit stores and let the stale one
 * answer a later query. A symlink is left behind for the same reason the
 * plugin tree leaves one: a binary predating the rename reads only `.kobe` and
 * would read an empty store as "this session never existed".
 */

import { existsSync, lstatSync, mkdirSync, renameSync, symlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { COMPAT_STATE_DIR_BASENAME, ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"

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
  const legacyDir = join(homeDir, COMPAT_STATE_DIR_BASENAME)
  if (canonicalDir === legacyDir) return []
  const moved: string[] = []
  for (const name of PTY_HOST_DATA_ENTRIES) {
    const canonical = join(canonicalDir, name)
    const legacy = join(legacyDir, name)
    try {
      // `existsSync` follows links, so a canonical entry we already moved to
      // (and linked back from) short-circuits here — the move is idempotent.
      if (existsSync(canonical)) continue
      const stat = lstatIfExists(legacy)
      // A symlink at the legacy path is our own leftover pointing at a
      // canonical entry that has since been deleted; renaming it would install
      // a self-referential link.
      if (!stat || stat.isSymbolicLink()) continue
      mkdirSync(canonicalDir, { recursive: true })
      renameSync(legacy, canonical)
      moved.push(name)
      try {
        symlinkSync(canonical, legacy)
      } catch {
        /* compatibility is a courtesy — a failed link never fails the move */
      }
    } catch {
      /* unreadable or cross-device home: leave the legacy entry where it is */
    }
  }
  return moved
}
