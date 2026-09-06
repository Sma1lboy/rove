/**
 * The Windows half of the process walk — the snapshot `foreground.ts` cannot
 * take with `ps`, and the parent chain Windows does not keep.
 *
 * Two things are broken on win32 and neither is visible from the POSIX path:
 *
 * 1. **There is no usable `ps`.** The `ps` on PATH is Git for Windows'
 *    Cygwin build, which rejects `-A` (`ps: unknown option -- A`, exit 1,
 *    EMPTY stdout) and whose `-W` mode lists native processes with PPID 0 and
 *    no argv. An empty snapshot parses to zero rows, and zero rows read as a
 *    confident "no engine anywhere" — which is how every task came to report
 *    `running: false` while its agent sat at the prompt. The process table
 *    comes from `Get-CimInstance Win32_Process` instead.
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
 *    The shim's `cmd.exe` is gone by the time anyone looks, so `sh.exe`'s
 *    ParentProcessId names a dead pid and NO ancestor walk from the tab's
 *    shell can ever reach `claude.exe`. Windows keeps no reparent-to-init
 *    rule that would heal this.
 *
 *    What does survive is the CONSOLE. Every process in that chain inherited
 *    the tab's ConPTY console handle, so `GetConsoleProcessList` — which
 *    node-pty already ships as a native addon for its own `pty.process` — can
 *    still name the whole cohort. {@link repairConsoleParentage} takes that
 *    membership and re-attaches each cohort member whose parent is missing to
 *    the tab's shell, rebuilding a walkable tree.
 *
 * Nothing here runs off win32: `psSnapshot` branches on the platform, and the
 * POSIX `ps` path is untouched.
 */

import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { type ProcRow, PsProbeUnavailableError, serializeProcRows } from "./process-rows.ts"

/**
 * `Get-CimInstance Win32_Process` rendered as `pid ppid commandline`.
 *
 * `-Property` narrows the CIM fetch to the four fields the walk reads.
 * `CommandLine` is null for processes this user may not open (and for the
 * kernel's own), so `Name` stands in: a row with no text at all would be
 * dropped by the parser and could break a chain that runs THROUGH it.
 * Command lines are flattened because a Windows command line may contain
 * literal newlines — Rove's own launch script does — and the snapshot format
 * is one process per line.
 */
export const WIN_PROCESS_LIST_COMMAND =
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
  "Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CommandLine,Name | " +
  "ForEach-Object { $c = $_.CommandLine; if (-not $c) { $c = $_.Name }; " +
  "\"$($_.ProcessId) $($_.ParentProcessId) $($c -replace '[\\r\\n\\t]+', ' ')\" }"

/** Windows path basename — both separators, no `node:path` platform coupling. */
function winBasename(path: string): string {
  const parts = path.split(/[\\/]+/)
  return parts[parts.length - 1] || path
}

/**
 * A Windows command line rewritten so the ARGV[0] parser can read it.
 *
 * `ps` prints argv joined by spaces; Windows hands back a raw command line in
 * which argv[0] is usually an absolute path, quoted when it contains spaces
 * (`"C:\Program Files\Git\usr\bin\sh.exe" …`). Splitting that on whitespace
 * yields `"C:\Program` — so the executable-identity parser sees `Program`,
 * not `sh`, and the walk misses the wrapper it was written to see through.
 * Replacing the first token with its basename is what makes a Windows row
 * look like the `ps` row the walk expects; the arguments are left verbatim.
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
 * Re-attach each console cohort's orphans to the shell that console belongs
 * to, so the tree is walkable again.
 *
 * `cohorts` maps a tab's shell pid to every pid attached to its console
 * (`null` = the console could not be read, e.g. the shell already exited —
 * that anchor is left alone rather than guessed at). Membership is the
 * authority: a process on this console really is running inside this tab.
 * So a cohort member whose parent is ALSO in the cohort keeps its real
 * parent — depth is preserved, and the shallowest-engine walk still prefers
 * a wrapper's engine child over that engine's own helpers — while a member
 * whose parent is dead or off-console hangs off the shell directly.
 *
 * The shell itself is never reparented (its parent is the PTY host, which is
 * not attached to the console), so the repair cannot build a cycle.
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
    for (const pid of cohort) {
      if (pid === anchor || reparent.has(pid)) continue
      const row = byPid.get(pid)
      if (!row || cohort.has(row.ppid)) continue
      reparent.set(pid, anchor)
    }
  }
  if (reparent.size === 0) return [...rows]
  return rows.map((row) => {
    const ppid = reparent.get(row.pid)
    return ppid === undefined || ppid === row.ppid ? row : { ...row, ppid }
  })
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
 * Not {@link import("./foreground.ts").PS_PROBE_TIMEOUT_MS}: that constant is
 * sized for a probe that answers in ~20ms, where 5s can only mean a stuck
 * process table. This one is a PowerShell start plus a CIM query, ~0.8s on an
 * idle machine — and on the loaded box Rove is built for (a dozen agents
 * compiling at once) a 5s cap fired on a probe that was merely slow, which
 * spends the whole point of the tri-state on noise: the tab reads "unknown",
 * the sidebar badge drops, and `send` refuses with `ENGINE_PROBE_FAILED`.
 * 10s keeps the same promise as the POSIX constant — wide enough never to
 * cost a true answer — and still fits two attempts inside the 20s engine
 * readiness window that polls it.
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
 * node-pty's `GetConsoleProcessList` addon, wherever the installed copy put
 * it. Resolved the same way `doctor-node-pty.ts` finds the package: the
 * bundle keeps `node-pty` external, so this is the copy actually loaded at
 * runtime rather than a build-time guess.
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
 * It has to be a child: `GetConsoleProcessList` reports the caller's own
 * console, so reading someone else's means `FreeConsole()` then
 * `AttachConsole(pid)` — and a process may be attached to only one console at
 * a time. Doing that in the CLI or the TUI would detach the terminal the user
 * is looking at. node-pty forks a fresh agent per pid for the same reason;
 * one child looping over every anchor costs one spawn per snapshot instead of
 * one per tab.
 *
 * The child reports its OWN pid alongside the lists because
 * `GetConsoleProcessList` counts the attached caller as a member, and that
 * transient is not part of the tab.
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
 * The production probe: PowerShell for the table, a forked agent for the
 * consoles, both against ONE deadline taken when the snapshot starts — so the
 * caller's budget is what it says it is rather than twice that.
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
 * The win32 replacement for one `ps -A -o pid=,ppid=,args=` run, in the same
 * text shape.
 *
 * `anchors` are the shell pids about to be walked. They are what the console
 * repair needs — and the reason {@link import("./foreground.ts").PsSnapshot}
 * takes them at all; the POSIX branch ignores them, because a POSIX parent
 * chain is already intact.
 *
 * Failure is a THROW, never a thin snapshot: with the parent chain severed,
 * rows we could not repair would answer "no engine" for a tab whose engine is
 * running, and that answer is the bug this file exists to fix.
 */
export async function winProcessSnapshot(anchors: readonly number[], probe: WinProcessProbe): Promise<string> {
  const rows = parseWinProcessList(await probe.processList())
  if (rows.length === 0) throw new PsProbeUnavailableError("Win32_Process returned no rows")
  if (anchors.length === 0) return serializeProcRows(rows)
  return serializeProcRows(repairConsoleParentage(rows, await probe.consoleCohorts(anchors)))
}
