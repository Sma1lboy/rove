/**
 * `kobe doctor --report`: bundle the diagnosis + recent logs + relevant env
 * into one attachable text file, so a bug report carries the context the
 * maintainer needs instead of a screenshot of the summary.
 *
 * Env discipline: this file gets pasted into public bug reports, so a value is
 * printed ONLY for a key on {@link REPORT_ENV_KEYS}. Every other ROVE_/KOBE_
 * var is listed as `KEY=(set)` — the maintainer still learns the knob is on,
 * which is the diagnostic part, while a credential someone parked in that
 * namespace (`ROVE_GH_PAT=ghp_…`; the plugin env contract lives there too)
 * never leaves the machine. Allowlisting VALUES rather than filtering by key
 * name or entropy is deliberate: a name filter misses what it hasn't seen and
 * entropy misreads a long path as a secret, whereas an unknown key here fails
 * closed — the cost is a missing value in one report, not a leaked token.
 * `buildReportBundle` is pure (logs + env injected) so the format is
 * unit-testable without touching disk.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { defaultDaemonLogPath, defaultPtyHostLogPath } from "@sma1lboy/kobe-daemon/daemon/paths"

/**
 * Keys whose VALUE is printed verbatim. Everything else is reported as `(set)`.
 * Add a key here when its value is what you'd ask a reporter for anyway — a
 * path, a port, a mode flag. Never add one that could hold a credential.
 */
const REPORT_ENV_KEYS = [
  "SHELL",
  "TERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "COLORTERM",
  "VISUAL",
  "EDITOR",
  // Rove's own knobs: where state lives, which transport, which engine.
  "ROVE_HOME_DIR",
  "KOBE_HOME_DIR",
  "ROVE_DAEMON_SOCKET_PATH",
  "KOBE_DAEMON_SOCKET_PATH",
  "ROVE_SOCKET_PATH",
  "KOBE_SOCKET_PATH",
  "KOBE_PTY_SOCKET_PATH",
  "ROVE_DAEMON_WEB_PORT",
  "KOBE_DAEMON_WEB_PORT",
  "KOBE_PTY_PORT",
  "KOBE_WEB_HOST",
  "ROVE_BIN_PATH",
  "KOBE_BIN_PATH",
  "KOBE_WORKTREE_ROOT_DIR",
  "ROVE_INVOKED_AS",
  "ROVE_PRODUCT_NAME",
  "ROVE_DEV",
  "KOBE_DEV",
  "KOBE_DEBUG",
  "KOBE_TERMINAL_BACKEND",
  "ROVE_TASK_ID",
  "KOBE_TASK_ID",
  "ROVE_TAB_ID",
  "KOBE_TAB_ID",
] as const

/** How many trailing log lines each log section carries (also named in its header). */
const LOG_TAIL_LINES = 200

function logTail(path: string, count: number): string {
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
 * `KEY=value` lines for the report's env section. Allowlisted keys carry their
 * value; any other ROVE_/KOBE_ var is reported present-but-redacted.
 */
export function reportEnvLines(env: NodeJS.ProcessEnv): string[] {
  const shown = new Set<string>(REPORT_ENV_KEYS)
  const keys = new Set<string>(shown)
  for (const key of Object.keys(env)) if (key.startsWith("ROVE_") || key.startsWith("KOBE_")) keys.add(key)
  return [...keys].sort().map((key) => {
    const value = env[key]
    if (value === undefined) return `${key}=(unset)`
    return shown.has(key) ? `${key}=${value}` : `${key}=(set)`
  })
}

/** Pure: assemble the bundle text from the diagnosis lines + injected logs/env. */
export function buildReportBundle(
  doctorLines: readonly string[],
  parts: { generatedAt: string; env: NodeJS.ProcessEnv; daemonLog: string; ptyLog: string },
): string {
  return [
    "# Rove doctor report",
    `generated: ${parts.generatedAt}`,
    "",
    "## diagnosis",
    ...doctorLines,
    "",
    "## environment",
    ...reportEnvLines(parts.env),
    "",
    `## daemon.log (last ${LOG_TAIL_LINES} lines)`,
    parts.daemonLog || "(empty or absent)",
    "",
    // Section header must match the real file name (<home>/.rove/pty.log) so a
    // bug-report reader can find the log the tail came from.
    `## pty.log (last ${LOG_TAIL_LINES} lines)`,
    parts.ptyLog || "(empty or absent)",
    "",
  ].join("\n")
}

/** Write the bundle to `rove-doctor-report.txt` in the cwd; return its path. */
export function writeReportBundle(doctorLines: readonly string[]): string {
  const path = join(process.cwd(), "rove-doctor-report.txt")
  writeFileSync(
    path,
    buildReportBundle(doctorLines, {
      generatedAt: new Date().toISOString(),
      env: process.env,
      daemonLog: logTail(defaultDaemonLogPath(), LOG_TAIL_LINES),
      ptyLog: logTail(defaultPtyHostLogPath(), LOG_TAIL_LINES),
    }),
  )
  return path
}
