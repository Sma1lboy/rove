/**
 * `~/.rove/secrets.json` — the one file Rove keeps credentials in.
 *
 * Rove's habit, everywhere else, is not to hold anyone's keys: the engine
 * adapters DETECT the vendor's own login (`engine/account-detect.ts` reads
 * codex's auth file) and report it, so the credential stays where its owner
 * put it. That works because every engine ships a CLI that stores its own. A
 * classifier endpoint does not, which leaves a key with nowhere to live but
 * an environment variable — and a long-lived TUI cannot be handed one after
 * it started. Hence this file, and hence its narrow shape: a flat string map,
 * nothing else, no schema to grow.
 *
 * Four rules it exists to keep:
 *
 *   1. **The environment still wins.** `$TYPESAFE_API_KEY` set in the shell
 *      overrides whatever is stored, so CI and a one-off `KEY=… rove …` keep
 *      behaving the way anyone would expect them to.
 *   2. **Never beside the settings.** `state.json` is opened by `rove
 *      config`, hand-edited, and pasted whole into bug reports. A key that
 *      lived there would leak by ordinary helpfulness, not by mistake.
 *   3. **Never rendered.** No UI caller is handed a stored secret. They ask
 *      {@link secretStatus}, whose `hint` is a {@link secretHint} tail —
 *      enough to answer "is the right key in there", useless to anyone
 *      reading over a shoulder or a screen share.
 *   4. **A concurrent writer never loses a key.** Every write happens under
 *      the task-index lockfile protocol, and every staging file left behind
 *      by a crash is swept. See {@link writeSecret}.
 *
 * **On Windows the 0600 is not what protects this file.** Node maps POSIX
 * mode bits onto the read-only attribute there; who may open the file is
 * decided by the directory's ACL, which is inherited from the user profile
 * and not set here. On that platform the protection is "it lives under your
 * profile", the same as every other per-user file — which is weaker than the
 * guarantee on macOS and Linux, and is why `docs/CONFIGURATION.md` says so
 * rather than letting "owner-only (0600)" read as cross-platform.
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { secretsPath } from "../env.ts"
import { acquireSync, releaseSync } from "../orchestrator/index/lockfile.ts"

/** How much of a key the hint shows. Enough to recognise, not to use. */
const HINT_TAIL = 4

function parse(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v
    return out
  } catch {
    // Corrupt: treat as empty rather than throwing on a path that runs while
    // someone is creating a task. A bad file is replaced by the next write,
    // and the worst case is one classification that does not happen.
    return {}
  }
}

function readAll(): Record<string, string> {
  try {
    return parse(readFileSync(secretsPath(), "utf8"))
  } catch {
    // Absent is the normal state — nobody has stored a secret yet.
    return {}
  }
}

/** Staging file for one write. Unique per CALL, so two writers in the same
 *  process cannot clobber each other's staging file and fail the survivor's
 *  rename with ENOENT. */
function stagingPath(path: string): string {
  return `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
}

/**
 * Remove staging files from writes that never completed.
 *
 * A crash between `writeFileSync(tmp)` and `renameSync(tmp, path)` leaves a
 * file holding the key verbatim. It is 0600, but it is also permanent and
 * invisible: nothing reads `*.tmp`, so it never appears in the settings UI,
 * never expires, and the only way anyone learns it exists is by listing the
 * directory. A key at rest that its owner does not know about is worse than
 * one they can see.
 *
 * Runs UNDER the lock, which is what makes "stale" decidable without a clock:
 * a live writer holds the lock, so anything staged while we hold it belongs
 * to a process that is gone. No age threshold, and no chance of deleting a
 * concurrent writer's file out from under it.
 */
function sweepStagingFiles(path: string): void {
  const dir = dirname(path)
  const prefix = `${basename(path)}.`
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(".tmp")) continue
    try {
      unlinkSync(join(dir, entry))
    } catch {
      // Best effort: a sweep is hygiene, and failing it must never fail the
      // write the user actually asked for.
    }
  }
}

/**
 * One read-modify-write transaction over the file.
 *
 * Under the SAME lockfile protocol the task index uses
 * (`orchestrator/index/lockfile.ts`: `pid:token`, `link(2)`-or-fail, stale
 * takeover when the recorded pid is gone), because the failure without it is
 * silent and this machine runs dozens of sessions at once — two processes
 * storing different keys both read, both mutate their own copy, and the
 * second write erases the first with nothing raised anywhere.
 *
 * A lock rather than the compare-and-swap in `engine/shared-config-write.ts`:
 * CAS is there because an ENGINE rewrites `~/.claude.json` while holding no
 * lock of ours. Every writer of THIS file is Rove, so mutual exclusion is the
 * whole problem, and a lock states that where a retry loop would only imply
 * it.
 */
function transact(mutate: (secrets: Record<string, string>) => void): void {
  const path = secretsPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const lockPath = `${path}.lock`
  const token = acquireSync(lockPath)
  try {
    sweepStagingFiles(path)
    const secrets = readAll()
    mutate(secrets)
    if (Object.keys(secrets).length === 0) {
      // Nothing left to hold: take the file away rather than leaving an empty
      // object behind, so its absence keeps meaning "no secrets stored".
      try {
        unlinkSync(path)
      } catch (err) {
        // Already gone is the whole point — clearing a key nobody stored must
        // not CREATE the file it is supposed to remove. Anything else (a
        // permission failure, a read-only home) is real and belongs to the
        // caller: writing an empty object instead would report success and
        // fail again for the same reason.
        if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err
      }
      return
    }
    const tmp = stagingPath(path)
    // Mode on the TEMP file, not a chmod after the rename: between a 0644
    // create and a later chmod there is a window where the key is world
    // readable, and it is exactly the window an attacker would want.
    writeFileSync(tmp, JSON.stringify(secrets), { encoding: "utf8", mode: 0o600 })
    renameSync(tmp, path)
  } finally {
    releaseSync(lockPath, token)
  }
}

/**
 * The stored value for `name`, or undefined. Callers that want the
 * environment to win should use {@link resolveSecret}.
 */
export function readSecret(name: string): string | undefined {
  const v = readAll()[name]
  return v?.trim() ? v.trim() : undefined
}

/**
 * The effective secret: the environment first, then the file. An env var set
 * to an EMPTY string counts as unset rather than as an override — that is
 * what `export FOO=` in a shell profile means in practice, and reading it as
 * "deliberately blank" would silently disable a key the user had saved.
 */
export function resolveSecret(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[name]?.trim() || readSecret(name)
}

/** Where the effective secret came from — what the Settings row reports. */
export type SecretSource = "env" | "file" | "none"

export interface SecretStatus {
  readonly source: SecretSource
  /** Tail of the STORED value; empty when nothing is stored. */
  readonly hint: string
}

/**
 * Everything a settings row needs about one secret, from ONE read.
 *
 * Source and hint as separate calls meant two `readFileSync`s per render, and
 * a settings screen re-renders on every cursor move. The file is small enough
 * that neither was slow, which is exactly why it would never have been
 * noticed.
 */
export function secretStatus(name: string, env: NodeJS.ProcessEnv = process.env): SecretStatus {
  const stored = readAll()[name]?.trim()
  const hint = stored ? secretHint(stored) : ""
  if (env[name]?.trim()) return { source: "env", hint }
  return { source: stored ? "file" : "none", hint }
}

/**
 * A safe rendering of a stored secret: the last few characters, nothing more.
 * Enough to tell two keys apart when someone asks "did I paste the production
 * one"; useless on its own.
 */
export function secretHint(value: string): string {
  const v = value.trim()
  return v.length <= HINT_TAIL ? "…" : `…${v.slice(-HINT_TAIL)}`
}

/** Store (or, with an empty value, remove) one secret. */
export function writeSecret(name: string, value: string): void {
  transact((secrets) => {
    const v = value.trim()
    if (v) secrets[name] = v
    else delete secrets[name]
  })
}
