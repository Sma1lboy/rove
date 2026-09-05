/**
 * Processes a dead PTY session left behind, and how to reclaim them.
 *
 * Rove's own killing is complete: `terminatePtyChild` signals the child's
 * whole process GROUP, so ending a session ends its subtree. The leak is the
 * path Rove never gets to run. When something OUTSIDE Rove kills an engine —
 * a `kill -9`, an OOM reaper, a crashed terminal — the host is never told, so
 * it never signals the group, and everything the engine had spawned is
 * reparented to init and runs forever. Measured on one developer machine:
 * eight survivors aged two to five days, several of them still burning CPU.
 *
 * ## The predicate
 *
 * A process is reported here only when ALL of these hold:
 *
 *   1. `KOBE_TERMINAL_PTY=1` is in its environment. The PTY host sets that
 *      variable on every child it spawns (`pty-child-controller.ts`) and
 *      nothing else on the machine does, so it marks the whole subtree as
 *      descended from a Rove terminal. This is what keeps the sweep off a
 *      process the user started themselves.
 *   2. Its parent is init (`ppid === 1`). Its parent died and nothing is
 *      coming to reap it.
 *   3. Its process group has no leader left. The leader of a hosted session's
 *      group IS the PTY child, so a leaderless group is a session that ended.
 *      This also excludes every ordinary daemon, which is its own leader.
 *   4. Its group is not a session the PTY host currently lists as alive, and
 *      is not this process's own group. A healthy task can never match.
 *
 * ## Why this reports instead of killing
 *
 * The predicate cannot read intent. A process deliberately backgrounded from
 * a Rove terminal whose tab was then closed satisfies every clause — on the
 * machine this was written against, two of the eight matches were database
 * tunnels. So a plain `doctor` run only ever LISTS them, with age and command
 * so the user can tell a leak from something they meant to keep, and killing
 * needs the explicit `--kill-orphans` flag. Typing that flag is the consent;
 * nothing sweeps on a timer, at host boot, or behind a y/N.
 *
 * POSIX only: Windows has no process groups to orphan a subtree into. And on
 * macOS the kernel refuses to hand a process's environment to a non-root
 * reader when the binary is SIP-protected, so a system binary (`/bin/sleep`
 * and friends) can never satisfy clause 1 there and is never reported. That
 * failure is closed by construction — the sweep skips what it cannot verify —
 * and it costs nothing in practice, because what actually leaks is the
 * long-running third-party program (`bun`, `node`, a browser, a CLI tool),
 * whose environment reads fine. A probe that could not run AT ALL is a
 * different thing and is reported as one: `ps eww` failing to spawn, or Linux
 * refusing every `/proc/<pid>/environ` under `hidepid=2`, leaves every
 * candidate unclassified, and "none" there is a claim nothing checked.
 */

import { readFileSync } from "node:fs"

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
export interface ProbeResult {
  readonly code: number
  readonly stdout: string
}

export type ProbeRunner = (argv: readonly string[]) => Promise<ProbeResult>

/**
 * Test seam for the two probes the predicate rests on.
 *
 * `platform` is here because the environment read has two entirely different
 * implementations (procfs on Linux, `ps eww` everywhere else) and a test that
 * cannot pick one only ever exercises whichever OS it happens to run on —
 * which is how a check nobody runs on Linux ships broken on Linux.
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

/**
 * Clauses 2-4 of the predicate, over the process table alone. Runs BEFORE the
 * environment read because reading environments is the expensive half: this
 * cuts ~900 processes to a handful, and only those get inspected.
 */
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
 * Clause 1: does this pid's environment carry the PTY marker?
 *
 * Linux exposes `/proc/<pid>/environ` exactly (NUL-separated), so read it
 * directly. macOS has no procfs and only surfaces environments through `ps
 * eww`, which appends them to the command column — hence the batched call and
 * the word-boundary match, so an argv that merely CONTAINS the marker text
 * cannot pass for the variable itself.
 */
export interface MarkedPidsResult {
  readonly marked: Set<number>
  /**
   * Why the environment read could not be TRUSTED, or null when it ran.
   *
   * This is the step that turns a candidate into a finding, so a probe that
   * never ran produces the same empty set as a machine with nothing wrong —
   * and doctor printed "✓ none" either way. A process that simply exited
   * between the two passes is still not a finding (ENOENT is an answer); a
   * refusal to read (`hidepid=2`, another uid, a `ps` that would not spawn)
   * is not.
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
        // ENOENT means it exited between the two passes — an answer, not a
        // failure. EACCES/EPERM means the kernel refused us, which under
        // `hidepid=2` or across uids is EVERY candidate, and reporting that
        // as "none" is the bug.
        const code = (err as NodeJS.ErrnoException).code
        if (code !== "ENOENT" && code !== "ESRCH") refused ??= `/proc/${pid}/environ: ${code ?? "unreadable"}`
      }
    }
    return { marked, failed: refused }
  }
  const result = await runProbe(["ps", "eww", "-o", "pid=,command=", "-p", pids.join(",")])
  // A macOS `ps eww` that RAN but omitted a SIP-protected binary's environment
  // stays closed by construction (see the file header) — only a `ps` that did
  // not run at all is reported here.
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

/**
 * The full predicate against the live process table. `liveSessionPids` are the
 * PTY host's currently-alive session pids (`pty.list`); an empty set is safe —
 * clause 3 already excludes any group whose leader is still running, and a
 * live session's leader always is.
 */
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
  // The SECOND probe gets the same treatment as the first. It did not, and it
  // is the one that decides: with the environment read broken every candidate
  // stays unmarked, the filter empties the list, and doctor reported a clean
  // machine it had never managed to look at.
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

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

/**
 * SIGTERM every orphaned group, then SIGKILL whatever is still there past a
 * short grace. Signals the GROUP rather than each pid for the same reason
 * `terminatePtyChild` does: the survivors are a subtree, and a per-pid kill
 * would leave the grandchildren to re-orphan on the next sweep.
 */
export async function killOrphanGroups(orphans: readonly Orphan[]): Promise<{ groups: number[]; survivors: number[] }> {
  const groups = [...new Set(orphans.map((row) => row.pgid))]
  for (const pgid of groups) {
    try {
      process.kill(-pgid, "SIGTERM")
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
    } catch {
      // Raced with its own exit — the next liveness check is the verdict.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, GROUP_POLL_MS))
  return { groups, survivors: survivors.filter(groupAlive) }
}
