/**
 * Atomic JSON write + mutation serializer for the daemon's file-backed stores.
 * The tmp name carries pid+uuid because a fixed `${path}.tmp` is shared across
 * a `rove daemon restart` handoff: the incoming daemon can truncate it and
 * rename partial JSON over the real file while the outgoing one still writes.
 * Reads stay per-store — corruption policy differs.
 */
import { randomUUID } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export interface WriteJsonAtomicOptions {
  /** File mode for the new file (e.g. 0o600 for records that name every repo you touch). */
  mode?: number
  /** Skip the 2-space indent; for high-churn stores where size matters more than diffs. */
  compact?: boolean
}

/**
 * tmp+rename for non-JSON runtime files (daemon and PTY-host pidfiles). A torn
 * `writeFile` leaves an empty pidfile, which parses as pid `0` — `kill` reads
 * that as the caller's own process group.
 */
export async function writeTextAtomic(path: string, text: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(tmp, text, { encoding: "utf8", mode })
  await rename(tmp, path)
}

export async function writeJsonAtomic(
  path: string,
  body: unknown,
  { mode, compact = false }: WriteJsonAtomicOptions = {},
): Promise<void> {
  const text = compact ? JSON.stringify(body) : JSON.stringify(body, null, 2)
  await writeTextAtomic(path, `${text}\n`, mode)
}

const locks = new Map<string, Promise<unknown>>()

/**
 * Serialize async sections keyed by `key`. Key on the FILE PATH, not the
 * store's internal key: documents are written whole, so a per-repo lock lets
 * two read-modify-writes interleave and the second rename drops the first.
 *
 * The tail settles to `undefined` either way so a rejection can't wedge the
 * queue; the entry is dropped when idle so the map doesn't grow per file.
 *
 * `fn` must NOT resolve to a promise: `tail.then(fn)` adopts it and holds the
 * slot until it settles. TypeScript can't catch this (`async () => p` is
 * `Promise<T>`). Wrap it (`[done]`, `{ done }`) and await outside the queue.
 */
export function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const tail = locks.get(key) ?? Promise.resolve()
  const run = tail.then(fn)
  const settled = run.then(
    () => undefined,
    () => undefined,
  )
  locks.set(key, settled)
  void settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key)
  })
  return run
}
