/**
 * Ending a process and everything descended from it, on the one platform
 * where a signal cannot: Windows.
 *
 * ConPTY has no process groups, and node-pty's own `kill()` reaches only the
 * processes attached to the pseudo console — asynchronously, and without
 * anything that allocated its own console or detached from it. A hosted
 * engine spawns exactly that shape (`shell → engine → helpers`, a dev server
 * the agent started), so ending the shell alone left the rest running with
 * their working directory inside the worktree — and Windows refuses to
 * unlink a directory some process has as its cwd, which is how every task
 * delete left an empty `~/.rove/worktrees/<repo>/<name>` behind with
 * `Permission denied`. `taskkill /T` walks the parent chain from the process
 * table, so it reaches the whole subtree whatever console it holds.
 *
 * Except where that chain is broken, and under Git Bash it is broken by
 * design. MSYS emulates `fork` + `exec`: the fork is a real Windows child,
 * but `exec` of another MSYS program starts a NEW Windows process and the
 * forked one exits. What bash runs — the `claude` npm shim, then the engine
 * it execs — therefore hangs off a Windows parent that no longer exists, and
 * `taskkill /T` on the shell never reaches it: a deleted task's engine kept
 * running (and messaging its dispatcher) with its cwd in the worktree. MSYS
 * keeps the real parentage in its own process table, which Git's `ps` prints
 * with each row's Windows pid. That table is read BEFORE anything is killed —
 * once the shell dies, its children are reparented to 1 there too — and
 * every Windows pid under the shell goes into the same `taskkill /T`.
 */

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

/** Upper bound on one `taskkill` run — it answers in milliseconds; a hung
 *  one must not hold a deletion behind it. */
const TASKKILL_TIMEOUT_MS = 5_000

/** Same bound for the MSYS `ps` read; on timeout the kill goes ahead on the
 *  Windows parent chain alone, which is what it did before. */
const MSYS_PS_TIMEOUT_MS = 5_000

interface MsysProcessRow {
  readonly pid: number
  readonly ppid: number
  readonly winpid: number
}

/**
 * Parse `ps -l` from MSYS/Cygwin: `PID PPID PGID WINPID TTY UID STIME COMMAND`,
 * with an optional one-letter status flag (`S`, `I`, `O`) ahead of the PID.
 * The header and anything unrecognisable are skipped, never guessed at.
 */
export function parseMsysPs(output: string): MsysProcessRow[] {
  const rows: MsysProcessRow[] = []
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*[A-Z]?\s+(\d+)\s+(\d+)\s+\d+\s+(\d+)\s/.exec(` ${line}`)
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), winpid: Number(m[3]) })
  }
  return rows
}

/**
 * Windows pids of every MSYS process descended from the one whose Windows pid
 * is `rootWinpid` — the root itself excluded, since the caller kills it
 * anyway. Empty when the root is not an MSYS process (a native shell): the
 * Windows parent chain is intact there and `taskkill /T` alone is complete.
 */
export function msysDescendantWinpids(rows: readonly MsysProcessRow[], rootWinpid: number): number[] {
  const root = rows.find((row) => row.winpid === rootWinpid)
  if (!root) return []
  const children = new Map<number, MsysProcessRow[]>()
  for (const row of rows) {
    if (row.pid === row.ppid) continue
    const siblings = children.get(row.ppid)
    if (siblings) siblings.push(row)
    else children.set(row.ppid, [row])
  }
  const found = new Set<number>()
  const seen = new Set<number>([root.pid])
  const queue = [root.pid]
  while (queue.length > 0) {
    const pid = queue.shift() as number
    for (const child of children.get(pid) ?? []) {
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      queue.push(child.pid)
      if (child.winpid !== rootWinpid) found.add(child.winpid)
    }
  }
  return [...found]
}

/**
 * Git ships `ps.exe` beside `usr\bin\bash.exe`; its `bin\bash.exe` is a native
 * launcher one directory up. Anything else (pwsh, cmd) has no MSYS table.
 */
export function msysPsFor(shellFile: string | undefined): string | null {
  if (!shellFile || !/bash(\.exe)?$/i.test(shellFile)) return null
  const dir = dirname(shellFile)
  for (const candidate of [join(dir, "ps.exe"), join(dir, "..", "usr", "bin", "ps.exe")]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function readMsysDescendants(psPath: string, rootWinpid: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile(psPath, ["-l"], { windowsHide: true, timeout: MSYS_PS_TIMEOUT_MS }, (err, stdout) => {
      resolve(err ? [] : msysDescendantWinpids(parseMsysPs(String(stdout)), rootWinpid))
    })
  })
}

/**
 * `taskkill /T /F /PID <pid>` — plus `/PID` for every MSYS descendant when the
 * child is a Git Bash shell (see the header). Resolves with one line for the
 * signal log — never rejects, because the child may already be gone and that
 * is the outcome the caller wanted.
 *
 * Only ever called with the pid of a child THIS host spawned and still
 * believes alive: a stale pid can have been reused by an unrelated process,
 * and `/F` does not ask. The MSYS pids are read from a table snapshot taken
 * immediately before, for the same reason.
 */
export async function taskkillProcessTree(pid: number, shellFile?: string): Promise<string> {
  const psPath = msysPsFor(shellFile)
  const descendants = psPath ? await readMsysDescendants(psPath, pid) : []
  const pids = [pid, ...descendants]
  const label = `taskkill /T /F ${pids.map((p) => `/PID ${p}`).join(" ")}`
  return new Promise((resolve) => {
    execFile(
      "taskkill",
      ["/T", "/F", ...pids.flatMap((p) => ["/PID", String(p)])],
      { windowsHide: true, timeout: TASKKILL_TIMEOUT_MS },
      (err, stdout, stderr) => {
        // Both streams: with several `/PID`s, one "not found" (an earlier
        // `/T` already reached it) must not hide the SUCCESS lines.
        const detail = [stdout, stderr].join(" ").trim().replace(/\s+/g, " ") || err?.message || ""
        resolve(err ? `${label} did not complete: ${detail}` : `${label}: ${detail}`)
      },
    )
  })
}
