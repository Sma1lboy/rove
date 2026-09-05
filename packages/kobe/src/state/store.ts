/**
 * State-file transactions preserve unrelated keys from other UI/CLI writers.
 * The task-index lock protocol serializes the entire fresh read + mutation +
 * rename; unique staging files separately protect readers from partial JSON.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { kvStatePath } from "../env.ts"
import { acquireSync, releaseSync } from "../orchestrator/index/lockfile.ts"

let corruptWarned = false

/** The flat JSON object persisted at `kvStatePath()`. */
export type StateSnapshot = Record<string, unknown>

/**
 * `savedRepos` as stored in an already-loaded snapshot (type-filtered).
 *
 * Lives beside {@link StateSnapshot} rather than in `repos.ts` so the
 * remote-project module can read the same key without importing `repos.ts`,
 * which imports IT — a cycle whose value imports bundle into a TDZ crash in
 * an unrelated verb.
 */
export function readSavedRepos(state: StateSnapshot): readonly string[] {
  const raw = state.savedRepos
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === "string")
}

/**
 * Read + parse the state file. Returns `{}` for a missing file, malformed
 * JSON, or a non-object root (array/string/number) — see the corrupt-file
 * policy in the module doc. Never throws.
 */
export function loadStateFile(): StateSnapshot {
  return readStateFile(false)
}

function readStateFile(ownsLock: boolean): StateSnapshot {
  const path = kvStatePath()
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    // Missing (or unreadable) file: normal fresh-machine case, start fresh.
    return {}
  }
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as StateSnapshot
    }
  } catch {
    // fall through to the corrupt-JSON handling below
  }
  if (!ownsLock) {
    // A reader that saw corrupt bytes must re-read under the write lock before
    // moving anything: another process may already have repaired the file.
    const lockPath = `${path}.lock`
    let token: string
    try {
      token = acquireSync(lockPath, 0)
    } catch {
      return {}
    }
    try {
      return readStateFile(true)
    } finally {
      releaseSync(lockPath, token)
    }
  }
  // The file exists but didn't parse as a JSON object: back it up instead of
  // silently discarding it, then start fresh. Best-effort — if the backup
  // rename itself fails (e.g. file vanished between read and rename), we
  // still must not throw or block the caller.
  try {
    renameSync(path, `${path}.corrupt-${Date.now()}`)
    if (!corruptWarned) {
      corruptWarned = true
      console.error(`[rove] ${path} is corrupted; backed up and starting fresh.`)
    }
  } catch {
    // Nothing more we can do; still return {} below.
  }
  return {}
}

/**
 * Atomic whole-file write: serialize to a process-unique
 * `state.json.<pid>.<nonce>.tmp`, then rename over `state.json` so a crash
 * mid-write can never leave a half-written file. The tmp name is unique per
 * call (not just per process) so two writes racing in the same process via
 * concurrent callers can't collide either. `undefined` values vanish at
 * JSON.stringify time, which is how key deletion serializes. Throws on I/O
 * failure — callers decide whether that's fatal (CLI) or logged-and-retried
 * (KVProvider's next flush).
 */
function writeStateFile(state: StateSnapshot): void {
  const path = kvStatePath()
  mkdirSync(dirname(path), { recursive: true })
  const nonce = Math.random().toString(36).slice(2)
  const tmp = `${path}.${process.pid}.${nonce}.tmp`
  // Compact (no `null, 2`): the file is written on EVERY kv flush and read
  // only by machines — pretty-printing tripled the bytes for no reader.
  // 0600: `engineCommand.*` holds a user-authored shell line, which is exactly
  // where someone pastes `--api-key=…`. Owner-only costs nothing here — the file
  // already lives under a single user's ~/.config.
  writeFileSync(tmp, JSON.stringify(state), { encoding: "utf8", mode: 0o600 })
  renameSync(tmp, path)
}

/**
 * Single read-merge-write transaction: re-read the file FRESH, hand the
 * snapshot to `mutate`, write the result atomically. The fresh read is the
 * whole point — basing the write on the on-disk state of *now* (not a
 * snapshot this process took earlier) is what stops one writer from
 * resurrecting/erasing keys another process changed in the meantime.
 *
 * `mutate` may return `false` to skip the write entirely (e.g. "repo
 * already saved, nothing to do" — the file is left byte-identical, not
 * rewritten). Any other return value writes.
 *
 * Returns the snapshot that is now on disk (or would be, when skipped).
 */
export function updateStateFile(mutate: (state: StateSnapshot) => boolean | undefined): StateSnapshot {
  const lockPath = `${kvStatePath()}.lock`
  const token = acquireSync(lockPath)
  try {
    const state = readStateFile(true)
    const shouldWrite = mutate(state)
    if (shouldWrite !== false) writeStateFile(state)
    return state
  } finally {
    releaseSync(lockPath, token)
  }
}

/**
 * Merge a set of key changes into the file: fresh read, apply ONLY the
 * keys present in `patch` (an explicit `undefined` value DELETES the key,
 * matching JSON stringify, which drops undefined
 * entries), atomic write. This is the multi-process-safe flush
 * primitive: KVProvider passes just its dirty keys; `setPersisted*` passes
 * a single key. Keys this writer never touched pass through untouched.
 */
export function patchStateFile(patch: StateSnapshot): StateSnapshot {
  return updateStateFile((state) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete state[key]
      else state[key] = value
    }
    return undefined
  })
}

/**
 * Read a boolean flag from state.json with an explicit default — the single
 * owner of the "stored bool with a default" rule. Only a real stored boolean
 * overrides `defaultValue`; a missing key OR any non-boolean value falls back.
 * This subsumes the `x === true` (default false) / `x !== false` (default true)
 * idioms flag modules would otherwise inline, where the idiom silently
 * encodes the default and is easy to get backwards.
 */
export function getPersistedBool(key: string, defaultValue: boolean): boolean {
  const value = loadStateFile()[key]
  return typeof value === "boolean" ? value : defaultValue
}

/** Persist a boolean flag — single-key read-merge-write via {@link patchStateFile}. */
export function setPersistedBool(key: string, value: boolean): void {
  patchStateFile({ [key]: value })
}

/**
 * Replace the WHOLE file with `snapshot`, discarding keys other processes
 * may have written. Deliberately destructive — the only legitimate caller
 * is KVProvider's `clear()` ("reset UI state" in Settings → Dev), whose
 * contract is "wipe every persisted key, including ones this process never
 * loaded". Everything else must go through {@link patchStateFile} /
 * {@link updateStateFile}; reaching for this in a normal write path
 * reintroduces the lost-update bug this module exists to fix.
 */
export function replaceStateFile(snapshot: StateSnapshot): void {
  updateStateFile((state) => {
    for (const key of Object.keys(state)) delete state[key]
    Object.assign(state, snapshot)
    return undefined
  })
}
