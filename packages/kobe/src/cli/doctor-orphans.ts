/**
 * Processes a dead PTY session left behind, and how to reclaim them.
 *
 * `terminatePtyChild` signals the whole process GROUP, so Rove's own kills are
 * complete. The leak is an engine killed OUTSIDE Rove (`kill -9`, OOM reaper,
 * crashed terminal): the host never signals the group and the subtree is
 * reparented to init forever. Measured on one machine: eight survivors aged two
 * to five days, several still burning CPU.
 *
 * ## The predicate — reported only when ALL hold
 *
 *   1. `KOBE_TERMINAL_PTY=1` is in its environment. Only the PTY host sets it
 *      (`pty-child-controller.ts`), so it keeps the sweep off user processes.
 *   2. `ppid === 1` — nothing is coming to reap it.
 *   3. Its process group has no leader. A hosted session's leader IS the PTY
 *      child, so leaderless = ended session; ordinary daemons lead themselves.
 *   4. Its group is neither a live `pty.list` session nor our own group.
 *
 * ## Reports instead of killing
 *
 * The predicate can't read intent: a process backgrounded from a since-closed
 * tab matches every clause (two of the eight measured were database tunnels).
 * So `doctor` only LISTS, with age and command; killing needs the explicit
 * `--kill-orphans` flag. Nothing sweeps on a timer, at boot, or behind a y/N.
 *
 * POSIX only (Windows has no process groups). On macOS, SIP-protected binaries'
 * environments are unreadable to non-root, so they never satisfy clause 1 —
 * closed by construction and harmless, since leaks are third-party programs
 * (`bun`, `node`, browsers). A probe that could not run AT ALL (`ps eww` failed
 * to spawn, `hidepid=2` refusing every environ) is reported as an error, not
 * "none".
 */

import { appendFileSync, readFileSync } from "node:fs"
import { formatDaemonInfo } from "@sma1lboy/kobe-daemon/daemon/crash-log"
import { defaultDaemonLogPath } from "@sma1lboy/kobe-daemon/daemon/paths"

/** Set by the PTY host on every child it spawns; inherited by the subtree. */
const PTY_MARKER = "KOBE_TERMINAL_PTY=1"

/** One row of the structural `ps` pass. */
export interface PsRow {
  readonly pid: number
  readonly ppid: number
  readonly pgid: number
  /** `ps` elapsed time, verbatim (`04-22:42:56`) — the age that makes a leak obvious. */
  readonly etime: string
  readonly rssKb: number
  readonly command: string
}

export interface Orphan extends PsRow {
  /** The dead session's pid: the group to signal to reach the whole subtree. */
  readonly pgid: number
}

/** How a probe subprocess reports back. `code` is load-bearing: a spawn that
 *  never ran returns 127 with empty stdout, which is indistinguishable from a
 *  successful probe that found nothing unless somebody reads the code. */
interface ProbeResult {
  readonly code: number
  readonly stdout: string
}

type ProbeRunner = (argv: readonly string[]) => Promise<ProbeResult>

/**
 * Test seam for the two probes. `platform` lets a test exercise both
 * environment readers (procfs on Linux, `ps eww` elsewhere) on any OS.
 */
export interface OrphanProbeDeps {
  readonly run?: ProbeRunner
  readonly platform?: string
  /** Reads `/proc/<pid>/environ`; throws with an errno `code` like the real one. */
  readonly readEnviron?: (pid: number) => string
}

const run: ProbeRunner = async (argv) => {
  try {
    const proc = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "ignore" })
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text().catch(() => ""), proc.exited])
    return { code, stdout }
  } catch {
    return { code: 127, stdout: "" }
  }
}

/** Parse `ps -A -o pid=,ppid=,pgid=,etime=,rss=,command=`. Command may contain spaces. */
export function parsePsRows(output: string): PsRow[] {
  const rows: PsRow[] = []
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 6) continue
    const [pid, ppid, pgid] = [parts[0], parts[1], parts[2]].map((value) => Number.parseInt(value ?? "", 10))
    const rssKb = Number.parseInt(parts[4] ?? "", 10)
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !Number.isFinite(pgid) || !Number.isFinite(rssKb)) continue
    rows.push({ pid, ppid, pgid, etime: parts[3] ?? "", rssKb, command: parts.slice(5).join(" ") })
  }
  return rows
}

/** True while any member of the group is still running (a live leader included). */
function pidAlive(pid: number, rows: readonly PsRow[]): boolean {
  return rows.some((row) => row.pid === pid)
}

/** Clauses 2-4, over the process table alone. Runs before the expensive
 *  environment read: cuts ~900 processes to a handful. */
export function orphanCandidates(
  rows: readonly PsRow[],
  selfPgid: number,
  liveSessionPids: ReadonlySet<number>,
): PsRow[] {
  return rows.filter(
    (row) => row.ppid === 1 && row.pgid !== selfPgid && !liveSessionPids.has(row.pgid) && !pidAlive(row.pgid, rows),
  )
}

/**
 * Clause 1: does this pid's environment carry the PTY marker? Linux reads
 * `/proc/<pid>/environ` (NUL-separated). macOS only has `ps eww`, which appends
 * the environment to the command column — hence the word-boundary match, so an
 * argv merely CONTAINING the marker text can't pass.
 */
export interface MarkedPidsResult {
  readonly marked: Set<number>
  /**
   * Why the environment read can't be TRUSTED, or null. A probe that never ran
   * yields the same empty set as a clean machine, so it must be surfaced. A
   * process that exited between passes (ENOENT) is an answer; a refusal
   * (`hidepid=2`, another uid, `ps` wouldn't spawn) is not.
   */
  readonly failed: string | null
}

export async function markedPids(pids: readonly number[], deps: OrphanProbeDeps = {}): Promise<MarkedPidsResult> {
  const runProbe = deps.run ?? run
  const readEnviron = deps.readEnviron ?? ((pid: number) => readFileSync(`/proc/${pid}/environ`, "utf8"))
  const marked = new Set<number>()
  if (pids.length === 0) return { marked, failed: null }
  if ((deps.platform ?? process.platform) === "linux") {
    let refused: string | null = null
    for (const pid of pids) {
      try {
        if (readEnviron(pid).split("\0").includes(PTY_MARKER)) marked.add(pid)
      } catch (err) {
        // ENOENT = exited between passes. EACCES/EPERM under `hidepid=2` or
        // across uids refuses EVERY candidate; that must not read as "none".
        const code = (err as NodeJS.ErrnoException).code
        if (code !== "ENOENT" && code !== "ESRCH") refused ??= `/proc/${pid}/environ: ${code ?? "unreadable"}`
      }
    }
    return { marked, failed: refused }
  }
  const result = await runProbe(["ps", "eww", "-o", "pid=,command=", "-p", pids.join(",")])
  // Only a `ps` that didn't run is a failure; SIP-omitted environments are
  // closed by construction (see header).
  if (result.code !== 0) return { marked, failed: `ps eww exited ${result.code}` }
  const marker = new RegExp(`(^|\\s)${PTY_MARKER}(\\s|$)`)
  for (const line of result.stdout.split("\n")) {
    const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? "", 10)
    if (Number.isFinite(pid) && marker.test(line)) marked.add(pid)
  }
  return { marked, failed: null }
}

/** Our own process group, so the sweep can never signal the shell running it. */
async function ownPgid(runProbe: ProbeRunner): Promise<number> {
  const result = await runProbe(["ps", "-o", "pgid=", "-p", String(process.pid)])
  const pgid = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(pgid) ? pgid : -1
}

/** The full predicate. `liveSessionPids` (`pty.list`) may be empty safely —
 *  clause 3 already excludes any group with a running leader. */
export async function collectOrphans(
  liveSessionPids: ReadonlySet<number>,
  deps: OrphanProbeDeps = {},
): Promise<{ orphans: Orphan[]; error: string | null }> {
  const runProbe = deps.run ?? run
  if ((deps.platform ?? process.platform) === "win32") return { orphans: [], error: null }
  const ps = await runProbe(["ps", "-A", "-o", "pid=,ppid=,pgid=,etime=,rss=,command="])
  if (ps.code !== 0) return { orphans: [], error: `could not read the process table — ps exited ${ps.code}` }
  const rows = parsePsRows(ps.stdout)
  const candidates = orphanCandidates(rows, await ownPgid(runProbe), liveSessionPids)
  // A broken environment read leaves every candidate unmarked, which would
  // report a clean machine nobody looked at — so it's an error too.
  const { marked, failed } = await markedPids(
    candidates.map((row) => row.pid),
    deps,
  )
  if (failed) return { orphans: [], error: `could not read process environments — ${failed}` }
  return { orphans: candidates.filter((row) => marked.has(row.pid)), error: null }
}

function formatMb(rssKb: number): string {
  return `${(rssKb / 1024).toFixed(0)} MB`
}

/** The `orphans:` section of the doctor report. */
export function orphanDoctorLines(
  orphans: readonly Orphan[],
  error: string | null,
  cliName: string,
  killing = false,
): string[] {
  if (error) return [`orphans: ✗ ${error}`]
  if (orphans.length === 0) return ["orphans: ✓ none — no processes left behind by a dead PTY session"]
  const totalMb = orphans.reduce((sum, row) => sum + row.rssKb, 0) / 1024
  const lines = [
    `orphans: ⚠ ${orphans.length} process(es) outlived the PTY session that spawned them (${totalMb.toFixed(0)} MB RSS)`,
    "         each is reparented to init, carries Rove's PTY marker, and its process",
    "         group leader is gone — no live task owns them",
  ]
  for (const row of [...orphans].sort((a, b) => b.rssKb - a.rssKb)) {
    lines.push(
      `         pid ${row.pid} (group ${row.pgid}) up ${row.etime}, ${formatMb(row.rssKb)}: ${row.command.slice(0, 90)}`,
    )
  }
  if (!killing) {
    lines.push(
      `         → \`${cliName} doctor --kill-orphans\` ends those process groups (SIGTERM, then SIGKILL)`,
      "         read the list first: something you backgrounded from a Rove terminal and then",
      "         closed the tab on looks exactly like a leak, and doctor cannot tell them apart",
    )
  }
  return lines
}

const GROUP_EXIT_GRACE_MS = 2_000
const GROUP_POLL_MS = 100

/**
 * Append one line per killed group to `daemon.log`. This is the only path that
 * ends a hosted session's tree WITHOUT the PTY host, so nothing else records it.
 * Written straight to the file (no daemon may be up) with the daemon's ISO
 * prefix so it interleaves.
 */
function logOrphanKill(pgid: number, signal: NodeJS.Signals, logPath: string = defaultDaemonLogPath()): void {
  try {
    appendFileSync(logPath, formatDaemonInfo("doctor-kill-orphans", `${signal} process group ${pgid}`))
  } catch {
    // A missing log directory or a read-only home must not stop the reclaim
    // the user explicitly asked for.
  }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

/** SIGTERM each orphaned group, SIGKILL survivors after a grace. Signals the
 *  GROUP: a per-pid kill would leave grandchildren to re-orphan. */
export async function killOrphanGroups(orphans: readonly Orphan[]): Promise<{ groups: number[]; survivors: number[] }> {
  const groups = [...new Set(orphans.map((row) => row.pgid))]
  for (const pgid of groups) {
    try {
      process.kill(-pgid, "SIGTERM")
      logOrphanKill(pgid, "SIGTERM")
    } catch {
      // Already gone, or the last member exited between listing and signalling.
    }
  }
  const deadline = Date.now() + GROUP_EXIT_GRACE_MS
  let survivors = groups.filter(groupAlive)
  while (survivors.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, GROUP_POLL_MS))
    survivors = survivors.filter(groupAlive)
  }
  for (const pgid of survivors) {
    try {
      process.kill(-pgid, "SIGKILL")
      logOrphanKill(pgid, "SIGKILL")
    } catch {
      // Raced with its own exit — the next liveness check is the verdict.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, GROUP_POLL_MS))
  return { groups, survivors: survivors.filter(groupAlive) }
}
