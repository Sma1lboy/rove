/**
 * A process snapshot of just the anchors' subtrees, read from Linux `/proc`
 * instead of forking `ps -A`. For walks that only descend from known shells
 * (the TUI's 2s live-engine probe): rows outside the subtrees are absent, so
 * it cannot answer ancestry questions (`hasAncestor`).
 *
 * Needs `/proc/<pid>/task/<tid>/children` (CONFIG_PROC_CHILDREN); without it,
 * and off Linux, it is plain {@link psSnapshot}.
 */

import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import { type PsSnapshot, psSnapshot } from "./foreground"
import { type ProcRow, serializeProcRows } from "./process-rows.ts"

const procChildrenSupported =
  process.platform === "linux" && existsSync(`/proc/${process.pid}/task/${process.pid}/children`)

/** ENOENT/ESRCH mid-walk: the process exited between reads, not a failed probe. */
function gone(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return code === "ENOENT" || code === "ESRCH"
}

/** Children of every thread: a child belongs to the thread that forked it. */
async function childPids(pid: number): Promise<number[]> {
  let tids: string[]
  try {
    tids = await readdir(`/proc/${pid}/task`)
  } catch (err) {
    if (gone(err)) return []
    throw err
  }
  const lists = await Promise.all(
    tids.map((tid) =>
      readFile(`/proc/${pid}/task/${tid}/children`, "utf8").catch((err) => {
        if (gone(err)) return ""
        throw err
      }),
    ),
  )
  return lists.flatMap((text) => text.split(" ").filter(Boolean).map(Number))
}

/** What `ps -o args=` prints: argv joined by spaces, `[comm]` when argv is empty. */
async function argsOf(pid: number): Promise<string | null> {
  try {
    const argv = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0").filter(Boolean)
    if (argv.length > 0) return argv.join(" ")
    return `[${(await readFile(`/proc/${pid}/comm`, "utf8")).trim()}]`
  } catch (err) {
    if (gone(err)) return null
    throw err
  }
}

/** Rows for every descendant of `anchors` (the anchors themselves excluded). */
export async function procDescendantRows(anchors: readonly number[]): Promise<ProcRow[]> {
  const rows: ProcRow[] = []
  // A racy table can reuse a pid into a cycle; visited bounds the walk.
  const visited = new Set<number>(anchors)
  let frontier = [...visited]
  while (frontier.length > 0) {
    const level = await Promise.all(frontier.map(async (ppid) => (await childPids(ppid)).map((pid) => ({ pid, ppid }))))
    frontier = []
    for (const { pid, ppid } of level.flat()) {
      if (visited.has(pid)) continue
      visited.add(pid)
      const args = await argsOf(pid)
      if (args === null) continue
      rows.push({ pid, ppid, args })
      frontier.push(pid)
    }
  }
  return rows
}

/** {@link PsSnapshot} over the anchors' subtrees; `ps` when `/proc` can't answer. */
export const descendantSnapshot: PsSnapshot = async (anchors) => {
  if (!procChildrenSupported || !anchors || anchors.length === 0) return psSnapshot(anchors)
  try {
    return serializeProcRows(await procDescendantRows(anchors))
  } catch {
    return psSnapshot(anchors)
  }
}
