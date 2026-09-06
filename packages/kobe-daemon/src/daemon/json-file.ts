/**
 * The atomic JSON write and the mutation serializer shared by the daemon's
 * file-backed stores.
 *
 * tmp+rename so a reader never sees a half-written file, and the tmp name
 * carries pid+uuid because a fixed `${path}.tmp` is shared state: during a
 * `rove daemon restart` handoff the outgoing daemon can still be mid-write
 * while the incoming one opens the same name, truncates it, and renames
 * partial JSON over the real file. Reads stay per-store — corruption policy
 * legitimately differs between them.
 *
 * {@link serialized} is the read half's other bookend: every store that does a
 * read-modify-write on one of these files funnels through it so two concurrent
 * mutations cannot both read the old document and race their renames.
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
 * The tmp+rename on its own, for the runtime files that are not JSON: the
 * daemon and PTY-host pidfiles.
 *
 * `writeFile` truncates before it writes, so an interrupted write leaves an
 * EMPTY file — and an empty pidfile is not merely unreadable, it parses as
 * pid `0`, which `kill` reads as the caller's own process group. Every other
 * file-backed store here already renames into place; the pidfile was the
 * exception, and the one whose torn state is dangerous rather than annoying.
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
 * Serialize async sections that share a resource named by `key`.
 *
 * The unit of contention is the FILE PATH, not whatever the file is keyed by
 * internally: these stores read and write their document whole, so locking per
 * repo (or per task) lets two read-modify-write cycles interleave and the
 * second `rename` silently drops the first one's mutation. Callers pass their
 * store path.
 *
 * The tail is settled to `undefined` on both outcomes — a rejected mutation
 * must not wedge the queue for every later caller — and the map entry is
 * dropped once nobody is behind it, so a long-lived daemon does not accumulate
 * an entry per file it has ever touched.
 *
 * `fn` must NOT return a promise as its value. `tail.then(fn)` adopts whatever
 * `fn` resolves to, so a returned promise extends the slot until that promise
 * settles and every later caller queues behind it. TypeScript cannot catch
 * this — `async () => somePromise` is typed `Promise<T>`, not `Promise<
 * Promise<T>>`. To hand a promise back to the caller, wrap it (`[done]`,
 * `{ done }`) and await it OUTSIDE the queue.
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
