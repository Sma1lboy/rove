/**
 * Bearer-token authentication for the daemon-hosted web transport.
 *
 * The web transport exposes mutating RPCs to the browser — `task.setCommand`
 * sets the engine's launch argv, which is arbitrary command execution. Its
 * other gate, the Origin check (`web-origin.ts`), is a CSRF control and not an
 * authentication one: browsers attach Origin automatically, so it stops
 * another site's JavaScript from reaching the daemon, but `curl` simply omits
 * the header and `originAllowed(null)` returns true. On its own it would let
 * anything that can open a socket to the port drive the daemon.
 *
 * This module is the other half: a secret the caller must present. The two
 * checks stack rather than replace each other — Origin answers "which page is
 * asking", the token answers "is this caller entitled at all".
 *
 * The secret is 32 random bytes in one 0600 file under the state dir, so the
 * OS enforces the boundary that matters on a shared machine: another local
 * user can still connect to the loopback port, but cannot read the file, and
 * so cannot form a request that passes. Rotation is `rm` + a daemon restart —
 * a missing file regenerates on the next read, so no rotate verb is needed.
 */

import { randomBytes, timingSafeEqual } from "node:crypto"
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

/** Constant-time compare, so a wrong token leaks no prefix through timing. */
export function tokensMatch(presented: string | null | undefined, expected: string): boolean {
  if (!presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, and length is not a secret.
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The token a request presents, from either channel.
 *
 * `Authorization: Bearer …` is the channel for everything that goes through
 * `fetch`. `?token=` exists for exactly one caller: `EventSource`, the browser
 * API behind the `/events` SSE stream, which has no way to set a request
 * header at all. A query token is the weaker channel (it lands in access logs
 * and referrers) — acceptable only because this server is loopback-bound and
 * the sole thing logging it is the daemon itself.
 */
export function presentedToken(req: Request, url: URL): string | null {
  const header = req.headers.get("authorization")
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (match) return match[1].trim()
  }
  return url.searchParams.get("token")
}

/**
 * Whether this path is part of the protected surface.
 *
 * The token guards daemon STATE — the RPC/SSE/data routes. It deliberately
 * does not guard the static shell (`/`, `/assets/*`, the favicon), for a
 * mechanical reason: a browser fetches subresources on its own, and those
 * requests carry neither the `Authorization` header (only `fetch` can set
 * one) nor the `?token=` query. Gating them 401s every script and stylesheet
 * the page just asked for, so the dashboard renders blank — with the token
 * perfectly valid. The shell is public build output with no secrets in it;
 * the moment it tries to learn anything about this machine it hits `/api/*`
 * or `/events`, and there the token is required.
 */
export function requiresWebToken(url: URL, healthPath: string): boolean {
  const path = url.pathname
  if (path === healthPath) return false
  return path === "/events" || path.startsWith("/api/")
}
