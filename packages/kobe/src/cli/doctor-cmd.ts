/** Read-only health report for the PureTUI runtime. */

import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { isStaleInstallError, resolveKobeSpawn } from "@sma1lboy/kobe-daemon/client/daemon-process"
import { resolveNodeBinary } from "@sma1lboy/kobe-daemon/client/pty-process"
import {
  defaultDaemonLogPath,
  defaultDaemonPidPath,
  defaultDaemonSocketPath,
  defaultPtyHostLogPath,
  defaultPtyHostPidPath,
  defaultPtyHostSocketPath,
} from "@sma1lboy/kobe-daemon/daemon/paths"
import { readPidFile } from "@sma1lboy/kobe-daemon/daemon/server"
import { homeDir, kvStatePath, roveStateDir } from "../env.ts"
import { formatBytes } from "../lib/format-bytes.ts"
import { kobeSkillState, skillInstallCommand } from "../lib/skill-install.ts"
import { t } from "../tui/i18n"
import { CURRENT_VERSION } from "../version.ts"
import { MIN_BUN_VERSION, isBunAtLeast } from "./bun-runtime.ts"
import {
  type DoctorFix,
  applyFixes,
  daemonRestartFix,
  defaultFixRuntime,
  engineTabsManualFix,
  humanOnlyFix,
  reinstallManualFix,
  resetManualFix,
  skillInstallFix,
  spawnHelperFix,
} from "./doctor-fix.ts"
import { classifyHookChannel, hookChannelDoctorLines } from "./doctor-hook-channel.ts"
import { installedSpawnHelpers, spawnHelperDoctorLines } from "./doctor-node-pty.ts"
import { terminalDoctorLines } from "./doctor-terminal.ts"
import { probeEngines, probeGit } from "./env-checks.ts"
import { inspectLegacyTmux, legacyTmuxDoctorLines } from "./legacy-tmux.ts"
import { activeCliName } from "./rename-compat.ts"

const CLI_NAME = activeCliName()

type PtySessionStatus = { alive?: boolean; parked?: boolean }

/** The slice of `debug.inspect` the hook-channel check reads. */
type InspectSnapshot = {
  activity?: { tabs?: Record<string, Record<string, { source?: string }>> }
}

type PtyInventory = {
  pid?: number
  rssBytes?: number
  sessions?: PtySessionStatus[]
  stats?: {
    ringBytes?: number
    ringCapacityBytes?: number
    parkedSessions?: number
    parkedScreenBytes?: number
    parkRestoreDeltas?: number
    parkRestoreFallbacks?: number
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"
  }
}

async function requestIfReachable<T>(
  socketPath: string,
  name: "daemon.status" | "pty.list" | "debug.inspect",
): Promise<T | null> {
  const client = new KobeDaemonClient(socketPath)
  try {
    return await client.request<T>(name, {})
  } catch {
    return null
  } finally {
    client.close()
  }
}

function fmtDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function describeFile(path: string): string {
  try {
    const stat = statSync(path)
    return `present (${formatBytes(stat.size)}, modified ${stat.mtime.toISOString()})`
  } catch {
    return "absent"
  }
}

function taskCount(path: string): number | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { tasks?: unknown[] }
    return Array.isArray(parsed.tasks) ? parsed.tasks.length : null
  } catch {
    return null
  }
}

function tailFile(path: string, count: number): string {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(-count)
      .join("\n")
  } catch {
    return ""
  }
}

/**
 * Is the entry point this process would re-exec still on disk? Runs the
 * spawn path's own resolver rather than re-deriving the candidate list, so
 * doctor cannot pass while the spawn path fails (or vice versa). Only a
 * StaleInstallError is a finding: any other throw means the resolver itself
 * had a problem, which is not a verdict about the install.
 */
function describeInstall(): { line: string; ok: boolean } {
  try {
    const [, entry] = resolveKobeSpawn([])
    return { line: `install:  ✓ ${entry ?? process.execPath}`, ok: true }
  } catch (err) {
    if (!isStaleInstallError(err)) return { line: `install:  ? could not check (${String(err)})`, ok: true }
    return {
      line: [
        "install:  ✗ GONE — this process is running from an install that no longer exists on disk",
        "          it cannot start a daemon; every reconnect fails the same way until you reinstall",
        "          → npm install -g @sma1lboy/rove   (then relaunch Rove)",
      ].join("\n"),
      ok: false,
    }
  }
}

async function appendUnavailableProcess(
  out: string[],
  label: string,
  pidPath: string,
  socketPath: string,
): Promise<"wedged" | "down"> {
  const pid = await readPidFile(pidPath)
  const wedged = pid !== null && pid !== undefined && isProcessAlive(pid)
  if (wedged) out.push(`${label}: ✗ WEDGED — process alive (pid ${pid}) but socket is unreachable`)
  else if (pid) out.push(`${label}: ✗ not running (stale pidfile → pid ${pid} is gone)`)
  else out.push(`${label}: ✗ not running (no pidfile)`)
  if (existsSync(socketPath)) out.push(`          orphan socket file present: ${socketPath}`)
  return wedged ? "wedged" : "down"
}

/**
 * Assemble the full read-only diagnosis as printable lines, plus the fixes
 * each failing check proposes (collected, never executed here).
 */
async function collectDoctor(): Promise<{ lines: string[]; fixes: DoctorFix[] }> {
  const daemonSocket = defaultDaemonSocketPath()
  const daemonLog = defaultDaemonLogPath()
  const ptySocket = defaultPtyHostSocketPath()
  const ptyLog = defaultPtyHostLogPath()
  const tasksPath = join(roveStateDir(), "tasks.json")
  const statePath = kvStatePath()
  const fixes: DoctorFix[] = []
  const git = await probeGit()
  if (!git.found) fixes.push(humanOnlyFix("git"))
  const engines = await probeEngines()
  if (!engines.anyUsable) fixes.push(humanOnlyFix("noEngine"))
  // Can this process still re-exec itself? A `bun`/`node` process holds its
  // entry open by inode, so uninstalling Rove out from under a running one
  // leaves it alive on a path that is gone — it keeps working until it needs
  // to spawn a daemon, then fails identically forever. The check
  // is exactly the resolution the spawn path performs, so the two can never
  // disagree about whether this install is intact.
  const install = describeInstall()
  if (!install.ok) fixes.push(reinstallManualFix())
  // Reachable only behind ROVE_SKIP_BUN_CHECK — the launcher refuses to start
  // on a Bun below the floor. That is exactly the run where the user needs to
  // be told which of their symptoms is just an unsupported runtime.
  const staleBun = !isBunAtLeast(Bun.version)
  if (staleBun) fixes.push(humanOnlyFix("staleBun"))
  const out = [
    "Rove doctor",
    `  build:  v${CURRENT_VERSION} (${process.platform} ${process.arch}, bun ${Bun.version})`,
    ...(staleBun
      ? [`          ⚠ bun ${Bun.version} is below the ${MIN_BUN_VERSION} Rove needs — terminals will not paint`]
      : []),
    `  home:   ${homeDir()}`,
    "",
    ...(await terminalDoctorLines()),
    git.line,
    "",
    ...engines.lines,
    "",
    install.line,
    "",
  ]

  const daemon = await requestIfReachable<Record<string, unknown>>(daemonSocket, "daemon.status")
  if (daemon) {
    const pid = typeof daemon.daemonPid === "number" ? daemon.daemonPid : "?"
    const uptime = typeof daemon.uptimeMs === "number" ? fmtDuration(daemon.uptimeMs) : "?"
    const tasks = typeof daemon.taskCount === "number" ? daemon.taskCount : "?"
    const clients = typeof daemon.attachedClients === "number" ? daemon.attachedClients : "?"
    out.push(`daemon:  ✓ running (pid ${pid}, up ${uptime}, ${tasks} task(s), ${clients} client(s))`)
    const version = typeof daemon.kobeVersion === "string" ? daemon.kobeVersion : undefined
    if (version && version !== CURRENT_VERSION) {
      out.push(`         ⚠ stale build: daemon is v${version}, you launched v${CURRENT_VERSION}`)
      out.push(`         → run \`${CLI_NAME} daemon restart\`, then relaunch Rove`)
      fixes.push(daemonRestartFix(CLI_NAME, "daemonStale"))
    } else if (version) out.push(`         build: v${version}`)
    // Hook channel: hooks are the only sub-second path to the badge, and
    // they fail SILENTLY (`kobe hook` swallows everything by contract), so
    // a dead channel reads as a merely sluggish UI. Read-only — the verdict
    // comes from activity entries the daemon already recorded.
    const snapshot = await requestIfReachable<InspectSnapshot>(daemonSocket, "debug.inspect")
    const tabs = snapshot?.activity?.tabs
    if (tabs) {
      const hookInput = { socketPath: daemonSocket }
      const verdict = classifyHookChannel({ tabs, ...hookInput })
      out.push("", ...hookChannelDoctorLines(verdict, hookInput, CLI_NAME))
      if (verdict.kind === "down") fixes.push(daemonRestartFix(CLI_NAME, "hooksDown"), engineTabsManualFix())
    } else {
      // `requestIfReachable` swallows its failure into null, so an
      // unanswered `debug.inspect` (a daemon predating the verb) would drop
      // this whole block without a word — the exact silence this check
      // exists to end. Say the check could not run instead.
      out.push("", "hooks:   ? could not read the daemon's activity registry (debug.inspect unavailable)")
      fixes.push(daemonRestartFix(CLI_NAME, "inspectStale"))
    }
  } else {
    const state = await appendUnavailableProcess(out, "daemon ", defaultDaemonPidPath(), daemonSocket)
    fixes.push(
      state === "wedged" ? resetManualFix(CLI_NAME, "resetDaemonWedged") : daemonRestartFix(CLI_NAME, "daemonDown"),
    )
    const tail = tailFile(daemonLog, 8)
    if (tail) {
      out.push("         last lines of daemon.log:")
      for (const line of tail.split("\n")) out.push(`         │ ${line}`)
    }
  }
  out.push("")

  const inventory = await requestIfReachable<PtyInventory>(ptySocket, "pty.list")
  if (inventory) {
    const sessions = inventory.sessions ?? []
    const parked = inventory.stats?.parkedSessions ?? sessions.filter((session) => session.parked).length
    out.push(
      `pty host: ✓ running (${sessions.length} session(s), ${sessions.filter((session) => session.alive).length} live, ${parked} parked)`,
    )
    if (typeof inventory.pid === "number" && typeof inventory.rssBytes === "number") {
      out.push(`         pid ${inventory.pid}, ${formatBytes(inventory.rssBytes)} RSS`)
    }
    const stats = inventory.stats
    if (stats && typeof stats.ringBytes === "number" && typeof stats.ringCapacityBytes === "number") {
      out.push(`         ring: ${formatBytes(stats.ringBytes)} / ${formatBytes(stats.ringCapacityBytes)}`)
    }
    if (stats && typeof stats.parkedScreenBytes === "number") {
      out.push(`         parked screens: ${formatBytes(stats.parkedScreenBytes)}`)
    }
    if (stats && typeof stats.parkRestoreDeltas === "number" && typeof stats.parkRestoreFallbacks === "number") {
      out.push(
        `         park wakes: ${stats.parkRestoreDeltas} delta, ${stats.parkRestoreFallbacks} full replay fallback`,
      )
    }
  } else {
    // Both PTY-host failure shapes end in `reset` (TROUBLESHOOTING: "If the
    // PTY host itself is wedged"), which kills live sessions — print-only.
    await appendUnavailableProcess(out, "pty host", defaultPtyHostPidPath(), ptySocket)
    fixes.push(resetManualFix(CLI_NAME, "resetPty"))
  }
  // Windows runs the PTY host under node (Bun has no PTY there). A kobe
  // installed with `bun install -g` may have no node at all, and the only
  // symptom is a host that never comes up — say so here instead.
  if (process.platform === "win32") {
    const node = resolveNodeBinary()
    out.push(
      node
        ? `         node: ✓ ${node} (the Windows PTY host runs under it)`
        : "         node: ✗ not found on PATH — the Windows PTY host cannot start\n         → install Node.js from https://nodejs.org",
    )
    if (!node) fixes.push(humanOnlyFix("windowsNode"))
  }
  // macOS: node-pty@1.1.0 ships spawn-helper at 0644. The root postinstall
  // restores +x on install; a tree where it did not run fails every node-pty
  // spawn with nothing on screen, so name it here.
  if (process.platform === "darwin") {
    const helpers = spawnHelperDoctorLines(installedSpawnHelpers())
    out.push(...helpers.lines)
    if (helpers.broken.length > 0) fixes.push(spawnHelperFix(helpers.broken))
  }
  out.push("")

  const legacy = await inspectLegacyTmux()
  out.push(...legacyTmuxDoctorLines(legacy), "")
  if (legacy.sessions.length > 0) fixes.push(resetManualFix(CLI_NAME, "resetLegacy"))

  const skill = kobeSkillState()
  const installCommand = skillInstallCommand()
  if (!skill.installed) {
    out.push("skill:   ✗ Rove agent skill not installed", `         → ${installCommand}`)
    fixes.push(skillInstallFix(installCommand, false))
  } else if (skill.stale) {
    const installed = skill.installedVersion === null ? "unstamped" : `v${skill.installedVersion}`
    out.push(`skill:   ⚠ Rove agent skill out of date (${installed}; this Rove wants v${skill.currentVersion})`)
    out.push(`         → ${installCommand}`)
    fixes.push(skillInstallFix(installCommand, true))
  } else out.push(`skill:   ✓ Rove agent skill installed (v${skill.installedVersion})`)
  out.push("")

  const count = taskCount(tasksPath)
  out.push(`tasks.json: ${describeFile(tasksPath)}${count === null ? "" : ` — ${count} task(s)`}`)
  out.push(`state.json: ${describeFile(statePath)}`)
  out.push(`daemon.log: ${describeFile(daemonLog)}`)
  out.push(`pty-host.log: ${describeFile(ptyLog)}`)
  return { lines: out, fixes }
}

export async function runDoctorSubcommand(argv: readonly string[] = []): Promise<void> {
  if (argv.some((arg) => arg === "--help" || arg === "-h" || arg === "help")) {
    process.stdout.write(
      [
        `Usage: ${CLI_NAME} doctor [--report] [--fix]`,
        "",
        "Read-only diagnosis of the daemon / Hosted PTY / engines / git / legacy tmux / state.",
        "",
        "Options:",
        "  --report      Also write a bug bundle (diagnosis + recent logs + env) to a file",
        "  --fix         Review the fixes one by one: safe ones run after a per-fix y/N,",
        "                risky ones (kill sessions, install software) are printed only",
        "  -h, --help    Print this help",
        "",
      ].join("\n"),
    )
    return
  }
  const report = argv.some((arg) => arg === "--report")
  const fix = argv.some((arg) => arg === "--fix")
  const unknown = argv.find((arg) => arg.length > 0 && arg !== "--report" && arg !== "--fix")
  if (unknown !== undefined) {
    process.stderr.write(
      `${CLI_NAME} doctor: unexpected argument "${unknown}"\n\nUsage: ${CLI_NAME} doctor [--report] [--fix]\n`,
    )
    process.exit(2)
  }

  const { lines, fixes } = await collectDoctor()
  if (!fix && fixes.length > 0) {
    lines.push("", t("doctor.fix.hint", { count: fixes.length, command: `${CLI_NAME} doctor --fix` }))
  }
  console.log(lines.join("\n"))
  if (fix) await applyFixes(fixes, defaultFixRuntime())
  if (report) {
    const { writeReportBundle } = await import("./doctor-report.ts")
    const path = writeReportBundle(lines)
    console.log(`\nreport written: ${path}`)
    console.log("attach this file to a bug report — it includes recent daemon + pty-host logs and env.")
  }
}
