/**
 * JSON read/merge/write transactions for configuration shared with engines.
 * The existing Rove lock serializes cooperating processes. A byte reread before
 * staging-file rename retries changes from engine writers that ignore our lock.
 * The reread/rename window is still a race; vendor cooperation would be needed
 * to close it. Lock format and the current Rove state-home override are shared
 * with the orchestrator's existing lock implementation.
 */

import { createHash, randomBytes } from "node:crypto"
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { mkdir, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { roveStateDir } from "../env.ts"
import { acquireSync, release, releaseSync } from "../orchestrator/index/lockfile.ts"
import { acquireWithRetry } from "../orchestrator/index/store-codec.ts"
import { readTextFileIfRegular, readTextFileIfRegularSync } from "./file-bounds.ts"

/** Config writes refuse files above 8 MiB, independently of transcript limits. */
export const MAX_SHARED_CONFIG_BYTES = 8 * 1024 * 1024

/**
 * Staging path, unique per CALL rather than per process. A shared `<file>.tmp`
 * — or a pid-only one, the moment a caller gains an `await` — lets a second
 * writer clobber the first's staging file and fail the survivor's rename with
 * ENOENT. The task index (`orchestrator/index/store.ts`) stages the same way
 * for the same reason.
 */
function stagingPath(file: string): string {
  return `${file}.rove-${process.pid}-${randomBytes(6).toString("hex")}.tmp`
}

/**
 * Lock file for `file`, flat in Rove's own state dir beside `tasks.json.lock` —
 * these targets live in the ENGINE's home (`~/.claude.json`,
 * `~/.claude/settings.json`) and we do not scatter Rove sidecars there. Keyed by
 * a hash of the absolute path so two targets never share a lock and the name
 * stays filesystem-safe.
 */
function sharedConfigLockPath(file: string): string {
  return join(roveStateDir(), `shared-config-${createHash("sha256").update(file).digest("hex").slice(0, 16)}.lock`)
}

/**
 * Attempts before giving up. Each retry means a real concurrent write landed;
 * more than a handful in a row means the file is under sustained rewrite and
 * blocking a launch any longer is worse than surfacing to the caller (both
 * callers treat a throw as best-effort and continue).
 */
const MAX_ATTEMPTS = 5

/**
 * Turn the file's raw bytes (`undefined` when it does not exist) into the
 * document to merge into, or `undefined` to abandon the write untouched. This
 * is where callers validate their own format. An unreadable or oversized file
 * never reaches the loader as a missing document.
 */
export type LoadSharedDoc = (raw: string | undefined) => Record<string, unknown> | undefined

/**
 * Produce the exact text to write, or `undefined` when nothing needs to change
 * (both callers run on every launch — don't churn the user's file mtime).
 * Callers serialize themselves so neither file's existing bytes shift.
 */
export type BuildSharedDoc = (doc: Record<string, unknown>) => string | undefined

/** ENOENT is "no file yet"; every other read failure (EACCES, EISDIR) must
 *  propagate rather than masquerade as an empty document we would then write
 *  over the top of. */
export function readSharedConfigSync(file: string): string | undefined {
  try {
    const raw = readTextFileIfRegularSync(file, MAX_SHARED_CONFIG_BYTES)
    if (raw === null) throw new Error(`Refusing non-regular or oversized config: ${file}`)
    return raw
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return undefined
    throw err
  }
}

async function readRaw(file: string): Promise<string | undefined> {
  try {
    const raw = await readTextFileIfRegular(file, MAX_SHARED_CONFIG_BYTES)
    if (raw === null) throw new Error(`Refusing non-regular or oversized config: ${file}`)
    return raw
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return undefined
    throw err
  }
}

export function updateSharedJsonSync(file: string, load: LoadSharedDoc, build: BuildSharedDoc): void {
  const lockPath = sharedConfigLockPath(file)
  const lockToken = acquireSync(lockPath)
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const before = readSharedConfigSync(file)
      const doc = load(before)
      if (!doc) return
      const text = build(doc)
      if (text === undefined) return
      const tmp = stagingPath(file)
      try {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(tmp, text, { mode: 0o600, flag: "wx" })
        // CAS against the ENGINE (it holds no lock): bytes moved since our read
        // => our merge is built on a document somebody already replaced, and
        // writing it would drop their changes.
        if (readSharedConfigSync(file) === before) {
          renameSync(tmp, file)
          return
        }
      } finally {
        try {
          unlinkSync(tmp)
        } catch {
          /* renamed into place, or never created */
        }
      }
    }
    throw new Error(`gave up updating ${file} after ${MAX_ATTEMPTS} concurrent writes`)
  } finally {
    releaseSync(lockPath, lockToken)
  }
}

export async function updateSharedJson(file: string, load: LoadSharedDoc, build: BuildSharedDoc): Promise<void> {
  const lockPath = sharedConfigLockPath(file)
  const lockToken = await acquireWithRetry(lockPath)
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const before = await readRaw(file)
      const doc = load(before)
      if (!doc) return
      const text = build(doc)
      if (text === undefined) return
      const tmp = stagingPath(file)
      try {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(tmp, text, { mode: 0o600, flag: "wx" })
        if ((await readRaw(file)) === before) {
          await rename(tmp, file)
          return
        }
      } finally {
        await unlink(tmp).catch(() => {})
      }
    }
    throw new Error(`gave up updating ${file} after ${MAX_ATTEMPTS} concurrent writes`)
  } finally {
    await release(lockPath, lockToken)
  }
}
