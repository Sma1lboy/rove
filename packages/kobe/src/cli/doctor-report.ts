/**
 * `kobe doctor --report`: diagnosis + recent logs + relevant env in one
 * attachable text file.
 *
 * Env discipline: this gets pasted into public bug reports, so a value prints
 * ONLY for a key on {@link REPORT_ENV_KEYS}; other ROVE_/KOBE_ vars show as
 * `KEY=(set)` (a `ROVE_GH_PAT=ghp_…` never leaves the machine). Allowlisting
 * values, not filtering by name or entropy, fails closed on unknown keys.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { defaultDaemonLogPath, defaultPtyHostLogPath } from "@sma1lboy/kobe-daemon/daemon/paths"

/**
 * Rove's own knobs by SUFFIX, expanded to both prefixes so neither spelling of
 * a knob gets redacted. (`WEB_HOST` is read only by the harness PTY sidecar,
 * as `KOBE_WEB_HOST` — the LAN escape hatch, so its value matters.)
 */
const REPORT_ENV_SUFFIXES = [
  "HOME_DIR",
  "DAEMON_SOCKET_PATH",
  "SOCKET_PATH",
  "PTY_SOCKET_PATH",
  "PTY_PORT",
  "WEB_HOST",
  "BIN_PATH",
  "DEV",
  "DEBUG",
  "TERMINAL_BACKEND",
  "TASK_ID",
  "TAB_ID",
] as const

/** Keys whose VALUE prints verbatim (paths, ports, mode flags). Never add one
 *  that could hold a credential. */
const REPORT_ENV_KEYS: readonly string[] = [
  "SHELL",
  "TERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "COLORTERM",
  "VISUAL",
  "EDITOR",
  ...REPORT_ENV_SUFFIXES.flatMap((suffix) => [`ROVE_${suffix}`, `KOBE_${suffix}`]),
  // No KOBE_ twin on purpose: `installRoveEnvCompatibility` deliberately skips
  // this one, so a `KOBE_INVOKED_AS` line would always read `(unset)`.
  "ROVE_INVOKED_AS",
]

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

/** Env section lines; non-allowlisted ROVE_/KOBE_ vars are redacted. */
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

/**
 * Write the bundle to `<home>/.rove/`, next to the logs it tails (honours
 * `ROVE_HOME_DIR`). Returns its path. Never cwd: users run it inside their
 * repo, where logs + env would sit one `git add -A` from a commit.
 */
export function writeReportBundle(doctorLines: readonly string[]): string {
  const dir = dirname(defaultDaemonLogPath())
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "rove-doctor-report.txt")
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
