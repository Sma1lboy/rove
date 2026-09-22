/**
 * Mints the bearer token the PTY sidecar authenticates with. Minter only: the
 * reader is `kobe-harness/pty-auth.mjs`, a live security boundary since
 * `pty-server.mjs` spawns shells, and it duplicates the path logic rather
 * than importing anything from here.
 *
 * The secret is 32 random bytes in one 0600 file under the state dir: another
 * local user can reach the loopback port but cannot read the file, so cannot
 * form a passing request. Rotation is `rm` + restarting the writer — a
 * missing file regenerates on the next read.
 */

import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  OWNER_ONLY_DIR_MODE,
  OWNER_ONLY_FILE_MODE,
  tightenDirPermissionsSync,
  tightenFilePermissionsSync,
} from "./owner-only.ts"

/** 32 bytes ≈ 256 bits, base64url so it survives a header and a query string. */
function mintToken(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * Re-`chmod` an existing token file and its directory — creation-time modes
 * cannot reach an already-loose install (see `owner-only.ts`).
 */
export function tightenTokenPermissions(file: string): void {
  tightenDirPermissionsSync(dirname(file))
  tightenFilePermissionsSync(file)
}

/**
 * The token for this install, minting + persisting one on first use.
 *
 * Atomic tmp+rename so a torn write never leaves a truncated secret that
 * authenticates nothing. Every existing path is re-tightened on the way
 * through, which is what closes an already-loose install.
 */
export function ensureWebToken(file: string): string {
  tightenTokenPermissions(file)
  if (existsSync(file)) {
    try {
      const existing = readFileSync(file, "utf8").trim()
      if (existing.length > 0) return existing
    } catch {
      /* unreadable — fall through and mint a replacement */
    }
  }
  const token = mintToken()
  mkdirSync(dirname(file), { recursive: true, mode: OWNER_ONLY_DIR_MODE })
  const staging = `${file}.${process.pid}.tmp`
  writeFileSync(staging, token, { encoding: "utf8", mode: OWNER_ONLY_FILE_MODE })
  renameSync(staging, file)
  tightenTokenPermissions(file)
  return token
}
