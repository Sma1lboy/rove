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
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

/** Owner-only, for the same reason `pty-freeze-store.ts` is: this file is a
 *  credential, and the mode arguments below only bind at creation time. */
const DIR_MODE = 0o700
const FILE_MODE = 0o600

/** 32 bytes ≈ 256 bits, base64url so it survives a header and a query string. */
function mintToken(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * Re-`chmod` an existing token file and its directory.
 *
 * `mkdirSync`/`writeFileSync`'s `mode` option applies ONLY when the path is
 * created — for a path that already exists it is a silent no-op. An install
 * whose `.rove` directory predates this module keeps its 0755 mode, and a
 * token file written by a build without the mode argument keeps 0644, leaving
 * the credential world-readable forever. Remediating only on creation would
 * therefore fix every install except the ones that are actually exposed.
 *
 * Best-effort: a chmod that fails (foreign owner, read-only mount) must not
 * take the web transport down — the token still works, it is just not as
 * tight as we would like.
 */
export function tightenTokenPermissions(file: string): void {
  try {
    chmodSync(dirname(file), DIR_MODE)
  } catch {
    /* absent, or not ours — the mkdir below still creates it 0700 */
  }
  try {
    chmodSync(file, FILE_MODE)
  } catch {
    /* absent, or not ours to chmod */
  }
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
  mkdirSync(dirname(file), { recursive: true, mode: DIR_MODE })
  const staging = `${file}.${process.pid}.tmp`
  writeFileSync(staging, token, { encoding: "utf8", mode: FILE_MODE })
  renameSync(staging, file)
  tightenTokenPermissions(file)
  return token
}
