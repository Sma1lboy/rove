import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"

/** A sandbox nothing has used for this long is stopped, its engines with it. Its files stay. */
export const SANDBOX_TTL_MS = 6 * 60 * 60 * 1000
/** Under the TTL so a running TUI or bridge never reads as idle. */
export const LEASE_HEARTBEAT_MS = 5 * 60 * 1000

export interface ExpiredLease {
  readonly path: string
  readonly home: string
}

const leasePath = (dir: string, home: string): string =>
  join(dir, createHash("sha256").update(home).digest("hex").slice(0, 16))

/**
 * Only homes under `.dev-sandbox/` or a temp directory are throwaway. An explicit home elsewhere
 * (a long-lived recording hub) is someone's on purpose, so it gets no lease and is never swept.
 */
export function isThrowawayHome(
  home: string,
  base: string,
  tempRoots: readonly string[] = defaultTempRoots(),
): boolean {
  return [base, ...tempRoots].some((root) => home === root || home.startsWith(root.endsWith(sep) ? root : root + sep))
}

function defaultTempRoots(): string[] {
  const roots = [tmpdir(), "/tmp", "/private/tmp"]
  return [...roots, ...roots.filter((root) => existsSync(root)).map((root) => realpathSync(root))]
}

/** The lease's mtime is the sandbox's last use; its content names the home. */
export function touchLease(dir: string, home: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(leasePath(dir, home), home)
}

export function dropLease(dir: string, home: string): void {
  rmSync(leasePath(dir, home), { force: true })
}

export function expiredLeases(dir: string, now: number, ttlMs = SANDBOX_TTL_MS): ExpiredLease[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((path) => now - statSync(path).mtimeMs >= ttlMs)
    .map((path) => ({ path, home: readFileSync(path, "utf8") }))
}
