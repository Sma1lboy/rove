/**
 * The browser client's optional password (`rove --web --set-password`) and the lockout that
 * guards it. Only a scrypt hash is stored; failures are counted per client IP and in total, and
 * both counters live on disk so a restart does not reset them. Everything is owner-only.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export interface PasswordRecord {
  readonly algo: "scrypt"
  readonly N: number
  readonly r: number
  readonly p: number
  readonly salt: string
  readonly hash: string
}

const COST = { N: 2 ** 15, r: 8, p: 1 }
const KEY_LENGTH = 32
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 1024

export function webPasswordPaths(bridgeDir: string): { password: string; lockout: string } {
  return { password: join(bridgeDir, "web-password.json"), lockout: join(bridgeDir, "web-login-lock.json") }
}

function derive(password: string, salt: Buffer, cost: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Node's default maxmem (32 MiB) is exactly 128·N·r at N=2^15 and refuses it.
    scrypt(password, salt, KEY_LENGTH, { ...cost, maxmem: 256 * cost.N * cost.r }, (err, key) =>
      err ? reject(err) : resolve(key),
    )
  })
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, COST)
  return { algo: "scrypt", ...COST, salt: salt.toString("base64"), hash: key.toString("base64") }
}

export async function verifyPassword(record: PasswordRecord, password: string): Promise<boolean> {
  const expected = Buffer.from(record.hash, "base64")
  const key = await derive(password, Buffer.from(record.salt, "base64"), record)
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** 0700 directory, 0600 file, written then renamed: the bridge's secrets on disk. */
export function writeOwnerOnly(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  chmodSync(dirname(path), 0o700)
  // Write-then-rename: a crash mid-write must not leave a half file that reads as "no lock".
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, body, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}

/** The stored hash, or null when no password is set (or the file is not one we wrote). */
export function readPassword(path: string): PasswordRecord | null {
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<PasswordRecord>
    const pow2 = (n: unknown): n is number => typeof n === "number" && Number.isInteger(Math.log2(n))
    if (raw.algo !== "scrypt" || !pow2(raw.N) || raw.N < COST.N || raw.N > 2 ** 20) return null
    if (typeof raw.r !== "number" || typeof raw.p !== "number") return null
    if (typeof raw.salt !== "string" || typeof raw.hash !== "string") return null
    return raw as PasswordRecord
  } catch {
    return null
  }
}

export function writePassword(path: string, record: PasswordRecord): void {
  writeOwnerOnly(path, `${JSON.stringify(record, null, 2)}\n`)
}

/** True when there was a password to remove. */
export function clearPassword(path: string): boolean {
  if (!existsSync(path)) return false
  rmSync(path, { force: true })
  return true
}

// ── lockout ──────────────────────────────────────────────────────────────────

export const IP_FAILURE_LIMIT = 5
export const IP_LOCK_MS = 15 * 60_000
export const GLOBAL_FAILURE_LIMIT = 20
export const GLOBAL_WINDOW_MS = 24 * 60 * 60_000

interface IpRecord {
  readonly failures: number
  readonly lockedUntil: number | null
  readonly last: number
}

export interface LockoutState {
  readonly ips: Readonly<Record<string, IpRecord>>
  /** Timestamps of failures from any client within the window. */
  readonly failures: readonly number[]
  /** Sticky: only `--unlock` or `--set-password` clears it. */
  readonly globalLocked: boolean
}

export type Lock = { readonly kind: "ip"; readonly retryAfterMs: number } | { readonly kind: "global" }

export const EMPTY_LOCKOUT: LockoutState = { ips: {}, failures: [], globalLocked: false }

export function lockOf(state: LockoutState, ip: string, now: number): Lock | null {
  if (state.globalLocked) return { kind: "global" }
  const until = state.ips[ip]?.lockedUntil
  return until && until > now ? { kind: "ip", retryAfterMs: until - now } : null
}

/** Drop failures outside the window and IP records with nothing left to remember. */
function prune(state: LockoutState, now: number): LockoutState {
  const ips: Record<string, IpRecord> = {}
  for (const [ip, rec] of Object.entries(state.ips)) {
    const locked = rec.lockedUntil !== null && rec.lockedUntil > now
    if (locked || now - rec.last < GLOBAL_WINDOW_MS) ips[ip] = rec
  }
  return { ...state, ips, failures: state.failures.filter((t) => now - t < GLOBAL_WINDOW_MS) }
}

export function recordFailure(
  prev: LockoutState,
  ip: string,
  now: number,
): { readonly state: LockoutState; readonly lock: Lock | null } {
  const state = prune(prev, now)
  const old = state.ips[ip]
  // An expired lock starts the count over.
  const base = old && old.lockedUntil !== null && old.lockedUntil <= now ? 0 : (old?.failures ?? 0)
  const failures = base + 1
  const lockedUntil = failures >= IP_FAILURE_LIMIT ? now + IP_LOCK_MS : null
  const all = [...state.failures, now]
  const next: LockoutState = {
    ips: { ...state.ips, [ip]: { failures, lockedUntil, last: now } },
    failures: all,
    globalLocked: state.globalLocked || all.length >= GLOBAL_FAILURE_LIMIT,
  }
  return { state: next, lock: lockOf(next, ip, now) }
}

/** A right password clears that IP's count; the global count stands. */
export function recordSuccess(state: LockoutState, ip: string): LockoutState {
  const { [ip]: _, ...rest } = state.ips
  return { ...state, ips: rest }
}

export function readLockout(path: string): LockoutState {
  if (!existsSync(path)) return EMPTY_LOCKOUT
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<LockoutState>
    const ips: Record<string, IpRecord> = {}
    for (const [ip, rec] of Object.entries(raw.ips ?? {})) {
      if (rec && typeof rec.failures === "number" && typeof rec.last === "number") {
        ips[ip] = { failures: rec.failures, last: rec.last, lockedUntil: rec.lockedUntil ?? null }
      }
    }
    const failures = Array.isArray(raw.failures) ? raw.failures.filter((t) => typeof t === "number") : []
    return { ips, failures, globalLocked: raw.globalLocked === true }
  } catch {
    // An unreadable counter file fails closed: the owner clears it with --unlock.
    return { ...EMPTY_LOCKOUT, globalLocked: true }
  }
}

export function writeLockout(path: string, state: LockoutState): void {
  writeOwnerOnly(path, `${JSON.stringify(state)}\n`)
}
