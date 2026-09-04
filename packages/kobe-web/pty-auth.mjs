/**
 * Bearer-token gate for the PTY sidecar.
 *
 * Every other browser-facing route already requires the web token: REST goes
 * through `withWebToken` and the SSE stream through `withWebTokenQuery`. The
 * PTY routes never adopted it, and they are the ones that spawn a shell in the
 * worktree — so their only gate was the Origin check, which passes for a
 * request with NO Origin (any local process) and for ANY loopback Origin (any
 * other page the user has open on localhost). Origin answers "which page is
 * asking"; the token answers "is this caller entitled at all". Both apply.
 *
 * The expected value is the same 0600 file the daemon mints
 * (`kobe-daemon/daemon/web-token.ts` + `defaultWebTokenPath`), read here
 * directly rather than passed down from whoever spawned this process: the
 * sidecar is started from four places (`rove web`, `dev.ts`, Playwright, by
 * hand), and a launcher that forgot to forward the secret would silently
 * reopen the hole. The path logic is duplicated instead of imported because
 * this file runs under node — node-pty does not work under bun — and the
 * daemon's path module is TypeScript.
 *
 * Fail closed: no readable token file means no request is served. That cannot
 * strand a working install, because the daemon mints the file before the
 * sidecar has anything to talk to.
 */

import { timingSafeEqual } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const STATE_DIR = ".rove"
const LEGACY_STATE_DIR = ".kobe"
const TOKEN_FILE = "web-token"

/** `<home>/.rove/web-token`, falling back to the legacy `.kobe` layout only
 *  when that is where the file actually is — mirrors `runtimeDataPath`. */
export function webTokenPath(env = process.env) {
  const home = env.ROVE_HOME_DIR ?? env.KOBE_HOME_DIR ?? homedir()
  const canonical = join(home, STATE_DIR, TOKEN_FILE)
  if (existsSync(canonical)) return canonical
  const legacy = join(home, LEGACY_STATE_DIR, TOKEN_FILE)
  return existsSync(legacy) ? legacy : canonical
}

let cached = ""

/**
 * The token this sidecar requires.
 *
 * Read lazily and cached once non-empty: the sidecar and the daemon come up
 * concurrently, so the file may not exist yet on the first request, and a
 * one-shot read at startup would then wedge the gate shut for the whole
 * process lifetime.
 */
export function expectedPtyToken(env = process.env) {
  if (cached) return cached
  try {
    cached = readFileSync(webTokenPath(env), "utf8").trim()
  } catch {
    /* absent or unreadable — stay empty and refuse */
  }
  return cached
}

/** The token a request presents: `Authorization: Bearer …`, or `?token=` for
 *  the WebSocket, which cannot set a request header. */
export function presentedPtyToken(headers, url) {
  const header = headers?.authorization
  if (typeof header === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (match) return match[1].trim()
  }
  return url?.searchParams?.get("token") ?? null
}

/** Constant-time compare, so a wrong token leaks no prefix through timing. */
export function ptyTokenAccepted(presented, expected) {
  if (!presented || !expected) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, and length is not a secret.
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The whole gate for one request. */
export function ptyRequestAuthorized(headers, url, env = process.env) {
  return ptyTokenAccepted(presentedPtyToken(headers, url), expectedPtyToken(env))
}

/** Test seam: drop the memoized token so a case can point at another home. */
export function resetPtyTokenCache() {
  cached = ""
}
