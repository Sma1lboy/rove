/**
 * The Windows half of the process walk: the snapshot `foreground.ts` cannot
 * take with `ps`, and the parent chain Windows does not keep.
 *
 * 1. **No usable `ps`.** The `ps` on PATH is Git for Windows' Cygwin build:
 *    it rejects `-A` (exit 1, EMPTY stdout) and its `-W` mode lists native
 *    processes with PPID 0 and no argv. Zero rows would read as a confident
 *    "no engine anywhere", so the table comes from `Get-CimInstance
 *    Win32_Process` instead.
 *
 * 2. **The parent chain to the engine is severed.** An npm-installed engine
 *    launches through a `.cmd` shim, so the real tree is
 *
 *        bash.exe (the tab's shell)
 *          └─ bash.exe -ilc "<launch script>"
 *               └─ cmd.exe (the npm shim)          ← exits immediately
 *                    └─ sh.exe .../npm/claude …
 *                         └─ claude.exe
 *
 *    The shim's `cmd.exe` exits at once, so `sh.exe`'s ParentProcessId names
 *    a dead pid and NO ancestor walk from the tab's shell reaches
 *    `claude.exe`; Windows has no reparent-to-init rule to heal this.
 *
 *    The CONSOLE survives: every process in the chain inherited the tab's
 *    ConPTY console, so `GetConsoleProcessList` (a native addon node-pty
 *    already ships) still names the whole cohort, and
 *    {@link repairConsoleParentage} re-attaches members with a missing parent
 *    to the tab's shell.
 *
 *    The same break hits the OTHER end of the identity walk: a `rove api`
 *    call from an engine's Bash tool runs through the npm `sh` shim, and the
 *    forked Git-Bash process exits on exec of `sh.exe` (MSYS parent → MSYS
 *    child), leaving a dead ParentProcessId. Without repair
 *    `hasAncestor(cli, tabShell)` is false, no dispatcher is recorded, and a
 *    bare `send` falls back to the ACTIVE task. The CLI's own (hidden)
 *    console still names its chain, so the same repair, anchored on the CLI,
 *    re-attaches the orphan to that console's root.
 *
 * win32 only: `psSnapshot` branches on the platform.
 */

import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { type ProcRow, PsProbeUnavailableError, serializeProcRows } from "./process-rows.ts"

/**
 * `Get-CimInstance Win32_Process` rendered as `pid ppid commandline`.
 *
 * `CommandLine` is null for processes this user may not open, so `Name`
 * stands in: a textless row would be dropped by the parser and break a chain
 * running THROUGH it. Newlines are flattened (Rove's own launch script has
 * them; the format is one process per line). Rows are in creation order
 * because {@link repairConsoleParentage} takes the OLDEST off-console member
 * as a console's root.
 */
const WIN_PROCESS_LIST_COMMAND =
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
  "Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CommandLine,Name,CreationDate | " +
  "Sort-Object CreationDate | " +
  "ForEach-Object { $c = $_.CommandLine; if (-not $c) { $c = $_.Name }; " +
  "\"$($_.ProcessId) $($_.ParentProcessId) $($c -replace '[\\r\\n\\t]+', ' ')\" }"

/** Windows path basename — both separators, no `node:path` platform coupling. */
function winBasename(path: string): string {
  const parts = path.split(/[\\/]+/)
  return parts[parts.length - 1] || path
}

/**
 * A Windows command line with argv[0] replaced by its basename, so it looks
 * like a `ps` row. argv[0] is usually an absolute path, quoted when it has
 * spaces (`"C:\Program Files\Git\usr\bin\sh.exe" …`); split on whitespace,
 * the identity parser would see `Program`, not `sh`. Arguments stay verbatim.
 */
export function normalizeWindowsArgs(commandLine: string): string {
  const line = commandLine.trim()
  if (!line) return ""
  if (line.startsWith('"')) {
    const end = line.indexOf('"', 1)
    if (end === -1) return winBasename(line.slice(1))
    return `${winBasename(line.slice(1, end))}${line.slice(end + 1)}`
  }
  const space = line.search(/\s/)
  if (space === -1) return winBasename(line)
  return `${winBasename(line.slice(0, space))}${line.slice(space)}`
}

/** Parse {@link WIN_PROCESS_LIST_COMMAND} output; unparsable lines are skipped. */
export function parseWinProcessList(text: string): ProcRow[] {
  const rows: ProcRow[] = []
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/.exec(line)
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), args: normalizeWindowsArgs(m[3]) })
  }
  return rows
}

/**
 * Re-attach each console cohort's orphans to the root of that console.
 *
 * `cohorts` maps an anchor pid to every pid on its console (`null` = console
 * unreadable, e.g. the shell exited; that anchor is left alone, not guessed
 * at). Membership is the authority. A member whose parent is ALSO in the
 * cohort keeps it, preserving depth so the shallowest-engine walk still
 * prefers a wrapper's engine child over its helpers; a member whose parent is
 * dead or off-console hangs off the root.
 *
 * The root is the anchor when the console begins there (a tab's shell, whose
 * parent is the off-console PTY host). An anchor can also be a LEAF (the
 * `rove api` CLI asking about its own console, see the header): then the root
 * is the oldest member whose parent is alive and off the console, and the
 * leaf is never a target, so the repair cannot build a cycle.
 */
export function repairConsoleParentage(
  rows: readonly ProcRow[],
  cohorts: ReadonlyMap<number, readonly number[] | null>,
): ProcRow[] {
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const reparent = new Map<number, number>()
  for (const [anchor, members] of cohorts) {
    if (!members || !byPid.has(anchor)) continue
    const cohort = new Set(members.filter((pid) => byPid.has(pid)))
    const root = cohortRoot(rows, byPid, cohort, anchor)
    if (root === undefined) continue
    for (const pid of cohort) {
      if (pid === root || reparent.has(pid)) continue
      const row = byPid.get(pid)
      if (!row || cohort.has(row.ppid)) continue
      reparent.set(pid, root)
    }
  }
  if (reparent.size === 0) return [...rows]
  return rows.map((row) => {
    const ppid = reparent.get(row.pid)
    return ppid === undefined || ppid === row.ppid ? row : { ...row, ppid }
  })
}

/**
 * The member a console's orphans hang off: the anchor when its own parent is
 * off the console (a tab's shell), else the oldest member whose parent is
 * alive and off the console, else the oldest whose parent is merely off it.
 * `rows` are in creation order (see {@link WIN_PROCESS_LIST_COMMAND}), so
 * "first" is "oldest". `undefined` when every member's parent is also a
 * member — a cycle, which a real process table cannot hold.
 */
function cohortRoot(
  rows: readonly ProcRow[],
  byPid: ReadonlyMap<number, ProcRow>,
  cohort: ReadonlySet<number>,
  anchor: number,
): number | undefined {
  const anchorRow = byPid.get(anchor)
  if (anchorRow && !cohort.has(anchorRow.ppid)) return anchor
  let orphanRoot: number | undefined
  for (const row of rows) {
    if (!cohort.has(row.pid) || cohort.has(row.ppid)) continue
    if (byPid.has(row.ppid)) return row.pid
    orphanRoot ??= row.pid
  }
  return orphanRoot
}

/** The two Windows reads, injectable so tests never spawn anything. */
export interface WinProcessProbe {
  /** `pid ppid commandline` for every process, or a throw. */
  processList(): Promise<string>
  /** Pids sharing each anchor's console; `null` where the console is unreadable. */
  consoleCohorts(anchors: readonly number[]): Promise<ReadonlyMap<number, readonly number[] | null>>
}

/** `powershell.exe` by absolute path — PATH is not guaranteed under a PTY. */
function powershellPath(): string {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows"
  const absolute = join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  return existsSync(absolute) ? absolute : "powershell.exe"
}

/**
 * The Windows snapshot's whole budget, shared by both of its children.
 *
 * Not {@link import("./foreground.ts").PS_PROBE_TIMEOUT_MS} (sized for a
 * ~20ms probe): PowerShell start + CIM query is ~0.8s idle, and under a dozen
 * compiling agents a 5s cap fired on merely-slow probes, turning tabs
 * "unknown" and making `send` refuse with `ENGINE_PROBE_FAILED`. 10s never
 * costs a true answer and still fits two attempts in the 20s engine
 * readiness window.
 */
export const WIN_PROBE_TIMEOUT_MS = 10_000

/** Run a child to completion by `deadline`, or throw {@link PsProbeUnavailableError}. */
async function capture(cmd: readonly string[], what: string, deadline: number): Promise<string> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new PsProbeUnavailableError(`${what} had no time left in the probe budget`)
  const proc = Bun.spawn(cmd as string[], { stdout: "pipe", stderr: "pipe" })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    // Kill first: an abandoned child holding a pipe nobody reads is how a
    // one-off hang becomes a permanent leak in a long-lived daemon.
    try {
      proc.kill()
    } catch {
      /* already gone */
    }
  }, remaining)
  try {
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (timedOut) throw new PsProbeUnavailableError(`${what} did not answer within ${remaining}ms`)
    if (code !== 0)
      throw new PsProbeUnavailableError(`${what} exited ${code}: ${err.trim().slice(0, 200) || "no output"}`)
    return out
  } catch (err) {
    if (err instanceof PsProbeUnavailableError) throw err
    throw new PsProbeUnavailableError(`${what} failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * node-pty's `GetConsoleProcessList` addon, resolved at runtime: the bundle
 * keeps `node-pty` external, so this is the copy actually loaded.
 */
function consoleListAddonPath(): string {
  let pkg: string
  try {
    pkg = dirname(createRequire(import.meta.url).resolve("node-pty/package.json"))
  } catch (err) {
    throw new PsProbeUnavailableError(`node-pty is not resolvable: ${err instanceof Error ? err.message : String(err)}`)
  }
  const candidates = [
    join(pkg, "prebuilds", `${process.platform}-${process.arch}`, "conpty_console_list.node"),
    join(pkg, "build", "Release", "conpty_console_list.node"),
    join(pkg, "build", "Debug", "conpty_console_list.node"),
  ]
  const found = candidates.find((c) => existsSync(c))
  if (!found) throw new PsProbeUnavailableError(`node-pty ships no conpty_console_list addon for ${process.arch}`)
  return found
}

/**
 * Ask a CHILD process which pids share each anchor's console.
 *
 * It has to be a child: reading another console means `FreeConsole()` +
 * `AttachConsole(pid)`, and a process has one console at a time, so doing it
 * in the CLI or TUI would detach the user's terminal. One child loops over
 * every anchor: one spawn per snapshot, not per tab.
 *
 * The child reports its OWN pid because `GetConsoleProcessList` counts the
 * attached caller as a member, and it is not part of the tab.
 */
function agentScript(addon: string, anchors: readonly number[]): string {
  return `const native = require(${JSON.stringify(addon)})
const lists = {}
for (const pid of ${JSON.stringify([...anchors])}) {
  try { lists[pid] = Array.from(native.getConsoleProcessList(pid)) } catch { lists[pid] = null }
}
process.stdout.write(JSON.stringify({ self: process.pid, lists }))`
}

function parseCohorts(json: string, anchors: readonly number[]): ReadonlyMap<number, readonly number[] | null> {
  const parsed = JSON.parse(json) as { self?: number; lists?: Record<string, number[] | null> }
  const self = typeof parsed.self === "number" ? parsed.self : -1
  const out = new Map<number, readonly number[] | null>()
  for (const anchor of anchors) {
    const list = parsed.lists?.[String(anchor)]
    out.set(anchor, Array.isArray(list) ? list.filter((pid) => pid > 0 && pid !== self) : null)
  }
  return out
}

/**
 * The production probe. Both children share ONE deadline taken at snapshot
 * start, so the caller's budget is not doubled.
 */
export function defaultWinProcessProbe(budgetMs: number = WIN_PROBE_TIMEOUT_MS): WinProcessProbe {
  const deadline = Date.now() + budgetMs
  return {
    processList: () =>
      capture(
        [powershellPath(), "-NoProfile", "-NonInteractive", "-NoLogo", "-Command", WIN_PROCESS_LIST_COMMAND],
        "Get-CimInstance Win32_Process",
        deadline,
      ),
    consoleCohorts: async (anchors) => {
      const script = agentScript(consoleListAddonPath(), anchors)
      const json = await capture([process.execPath, "-e", script], "console process list", deadline)
      return parseCohorts(json, anchors)
    },
  }
}

/**
 * The win32 replacement for one `ps -A -o pid=,ppid=,args=` run, same text
 * shape.
 *
 * `anchors`: every tab shell about to be walked, plus the caller for an
 * ancestry check on itself. Only the console repair uses them; the POSIX
 * branch of {@link import("./foreground.ts").PsSnapshot} ignores them.
 *
 * Failure is a THROW, never a thin snapshot: unrepaired rows would answer
 * "no engine" for a tab whose engine is running.
 */
export async function winProcessSnapshot(anchors: readonly number[], probe: WinProcessProbe): Promise<string> {
  const rows = parseWinProcessList(await probe.processList())
  if (rows.length === 0) throw new PsProbeUnavailableError("Win32_Process returned no rows")
  if (anchors.length === 0) return serializeProcRows(rows)
  return serializeProcRows(repairConsoleParentage(rows, await probe.consoleCohorts(anchors)))
}
