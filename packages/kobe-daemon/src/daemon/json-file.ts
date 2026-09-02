/**
 * The one atomic JSON write shared by the daemon's file-backed stores.
 *
 * tmp+rename so a reader never sees a half-written file, and the tmp name
 * carries pid+uuid because a fixed `${path}.tmp` is shared state: during a
 * `rove daemon restart` handoff the outgoing daemon can still be mid-write
 * while the incoming one opens the same name, truncates it, and renames
 * partial JSON over the real file. Reads stay per-store — corruption policy
 * legitimately differs between them.
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

export async function writeJsonAtomic(
  path: string,
  body: unknown,
  { mode, compact = false }: WriteJsonAtomicOptions = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`
  const text = compact ? JSON.stringify(body) : JSON.stringify(body, null, 2)
  await writeFile(tmp, `${text}\n`, { encoding: "utf8", mode })
  await rename(tmp, path)
}
