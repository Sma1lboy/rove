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
 * `savedRepos` from a loaded snapshot (type-filtered). Lives here, not in
 * `repos.ts`, so `remote-repos.ts` avoids an import cycle (a TDZ crash when bundled).
 */
export function readSavedRepos(state: StateSnapshot): readonly string[] {
  const raw = state.savedRepos
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === "string")
}

/**
 * Read + parse the state file. Returns `{}` for a missing file, malformed
 * JSON, or a non-object root; a corrupt file is backed up under the lock
 * (see `readStateFile`). Never throws.
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
  // Back up a non-object file rather than discard it. Best-effort: a failed
  // rename must still not throw or block the caller.
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
 * Atomic write via a per-call-unique `state.json.<pid>.<nonce>.tmp` + rename,
 * so a crash never leaves a half-written file. `undefined` values vanish at
 * stringify time (that is how deletion serializes). Throws on I/O failure;
 * callers decide fatal (CLI) vs retry (KVProvider's next flush).
 */
function writeStateFile(state: StateSnapshot): void {
  const path = kvStatePath()
  mkdirSync(dirname(path), { recursive: true })
  const nonce = Math.random().toString(36).slice(2)
  const tmp = `${path}.${process.pid}.${nonce}.tmp`
  // Compact: written on every kv flush, read only by machines (pretty-printing
  // tripled the bytes). 0600: `engineCommand.*` is where users paste `--api-key=…`.
  writeFileSync(tmp, JSON.stringify(state), { encoding: "utf8", mode: 0o600 })
  renameSync(tmp, path)
}

/**
 * Locked read-merge-write. The FRESH read is the point: writing from an
 * earlier snapshot would resurrect/erase keys another process changed.
 * `mutate` returning `false` skips the write (file stays byte-identical).
 * Returns the snapshot now on disk.
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
 * Multi-process-safe flush: apply ONLY the keys in `patch` (an explicit
 * `undefined` DELETES the key); untouched keys pass through.
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
 * Read a boolean flag with an explicit default: only a stored boolean
 * overrides it; missing or non-boolean falls back. Use this instead of
 * `x === true` / `x !== false`, which encode the default silently.
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
 * Replace the WHOLE file, discarding other processes' keys. Only caller:
 * KVProvider's `clear()` (Settings → Dev "reset UI state"). Anything else must
 * use {@link patchStateFile} / {@link updateStateFile} or reintroduces lost updates.
 */
export function replaceStateFile(snapshot: StateSnapshot): void {
  updateStateFile((state) => {
    for (const key of Object.keys(state)) delete state[key]
    Object.assign(state, snapshot)
    return undefined
  })
}
