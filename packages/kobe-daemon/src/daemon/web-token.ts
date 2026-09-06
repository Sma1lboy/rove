/**
 * Mints the bearer token the PTY sidecar authenticates with.
 *
 * This is now a MINTER only. It used to be both halves of a two-gate scheme
 * for the daemon-hosted web transport — this token plus an Origin check
 * (`web-origin.ts`) — but #855 deleted the transport, and with it both
 * `web-origin.ts` and every caller of the verifying half. The remaining
 * consumers all write the file: `kobe-harness/dev.ts`, `e2e/hero-fixture.ts`
 * and `scripts/fixture-core.ts`.
 *
 * The reader is `kobe-harness/pty-auth.mjs`, which gates the PTY sidecar —
 * a live security boundary, since `pty-server.mjs` spawns shells. It
 * deliberately duplicates the path logic rather than importing it (see its
 * own header), so it does not depend on anything exported here.
 *
 * The secret is 32 random bytes in one 0600 file under the state dir, so the
 * OS enforces the boundary that matters on a shared machine: another local
 * user can still connect to the loopback port, but cannot read the file, and
 * so cannot form a request that passes. Rotation is `rm` + restarting whatever
 * writes it (the harness dev server, or a fixture's setup) — a missing file
 * regenerates on the next read, so no rotate verb is needed.
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
 * Re-`chmod` an existing token file and its directory.
 *
 * The dir+file PAIR is what is specific to this module; why a repair pass is
 * needed at all (mkdir/write modes bind only at creation, so the loose
 * installs are exactly the ones creation-time modes cannot reach) is the
 * shared reasoning in `owner-only.ts`.
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
