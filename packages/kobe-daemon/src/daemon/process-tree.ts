/**
 * Ending a process tree on Windows, where no signal can.
 *
 * ConPTY has no process groups; node-pty's `kill()` reaches only processes
 * attached to the pseudo console, asynchronously. Engine helpers (a dev server
 * the agent started) survive with cwd in the worktree, and Windows refuses to
 * unlink a directory that is some process's cwd — task delete left an empty
 * `~/.rove/worktrees/<repo>/<name>` with `Permission denied`. `taskkill /T`
 * walks the parent chain, reaching the subtree whatever console it holds.
 *
 * Git Bash breaks that chain: MSYS `exec` starts a NEW Windows process and the
 * forked one exits, so the `claude` shim and engine hang off a dead Windows
 * parent that `taskkill /T` never reaches. MSYS's own table (Git's `ps`, with
 * Windows pids) keeps real parentage; it is read BEFORE killing — after the
 * shell dies its children reparent to 1 — and all its pids join the same
 * `taskkill /T`.
 */

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

/** It answers in ms; a hung one must not hold a deletion behind it. */
const TASKKILL_TIMEOUT_MS = 5_000

/** On timeout the kill proceeds on the Windows parent chain alone. */
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
 * Windows pids of MSYS descendants of `rootWinpid`, root excluded. Empty for a
 * non-MSYS root, whose Windows parent chain `taskkill /T` already covers.
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
 * `taskkill /T /F`, plus every MSYS descendant for a Git Bash shell. Resolves
 * with one signal-log line; never rejects (already-gone is the goal).
 *
 * Only for a child THIS host spawned and believes alive: a stale pid may be
 * reused and `/F` doesn't ask — same reason the MSYS snapshot is taken just before.
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
