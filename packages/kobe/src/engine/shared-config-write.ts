/**
 * Compare-and-swap writes for the config files Rove SHARES with the engine it
 * launches — Claude Code's `~/.claude.json` (worktree trust) and
 * `~/.claude/settings.json` / `~/.codex/hooks.json` (activity hooks).
 *
 * Three Rove PROCESSES read-modify-write these on every launch (daemon
 * `core/daemon-session-adapter.ts`, TUI `tui/workspace/terminal-tab-argv.ts`,
 * CLI `cli/api/runtime.ts`) — and so does the engine itself, which rewrites the
 * whole document on every save of its own. Losing that race is invisible: an
 * already-granted `allowedTools` entry disappears and the agent re-asks for
 * permission, or a task's trust entry vanishes and its session sits at "Do you
 * trust the files in this folder?" forever. It reads as an engine bug.
 *
 * TWO writer classes, so two layers — neither alone is enough:
 *
 *   1. **Lock** (`~/.rove/locks/`, reusing `orchestrator/index/lockfile.ts`)
 *      excludes the three Rove processes from each other, which a bare
 *      compare-and-swap cannot: check-then-rename is itself a TOCTOU, and two
 *      Rove writers can both pass the re-read and both rename. Measured on a
 *      3-writer sandbox run, CAS alone dropped ~40% of concurrent Rove updates.
 *   2. **Compare-and-swap** (re-read the raw bytes immediately before the
 *      rename, retry when they moved) covers THE ENGINE, which will never take
 *      our lock — it is not our process and has no idea Rove exists.
 *
 * ponytail: CAS narrows the engine window from "read + parse + merge"
 * (milliseconds — `~/.claude.json` is routinely 350KB) to "re-read + rename"
 * (microseconds). It does NOT close it. An engine write landing inside that
 * window still wins and drops our key; the user's recourse is unchanged
 * (relaunch). Closing it needs the engine to cooperate — a lock it takes, or an
 * API — which no vendor offers today. So: do NOT delete the CAS believing the
 * lock covers it, and do NOT believe the lock makes this safe against claude.
 *
 * The lock lives under the RESOLVED `~/.rove/` (`env.ts#roveStateDir`), keyed by
 * the target file's absolute path. Every Rove install — brew, npm, a dev
 * checkout — resolves the same `$HOME`, so mixed installs share one lock; only
 * an explicit `ROVE_HOME_DIR` split (tests, `dev:sandbox`) separates them, which
 * is exactly what that override is for.
 */

import { createHash, randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { roveStateDir } from "../env.ts"
import { acquireSync, release, releaseSync } from "../orchestrator/index/lockfile.ts"
import { acquireWithRetry } from "../orchestrator/index/store-codec.ts"

/**
 * Staging path, unique per CALL rather than per process. A shared `<file>.tmp`
 * — or a pid-only one, the moment a caller gains an `await` — lets a second
 * writer clobber the first's staging file and fail the survivor's rename with
 * ENOENT. That is issue #53, already paid for once in the task index
 * (`orchestrator/index/store.ts`).
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
export function sharedConfigLockPath(file: string): string {
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
 * is where the two callers differ: trust treats a corrupt store as empty
 * (claude's own recovery behavior), the hook installer refuses to clobber a
 * config it could not parse.
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
function readRawSync(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw err
  }
}

async function readRaw(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw err
  }
}

export function updateSharedJsonSync(file: string, load: LoadSharedDoc, build: BuildSharedDoc): void {
  const lockPath = sharedConfigLockPath(file)
  const lockToken = acquireSync(lockPath)
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const before = readRawSync(file)
      const doc = load(before)
      if (!doc) return
      const text = build(doc)
      if (text === undefined) return
      const tmp = stagingPath(file)
      try {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(tmp, text)
        // CAS against the ENGINE (it holds no lock): bytes moved since our read
        // => our merge is built on a document somebody already replaced, and
        // writing it would drop their changes.
        if (readRawSync(file) === before) {
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
        await writeFile(tmp, text)
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
