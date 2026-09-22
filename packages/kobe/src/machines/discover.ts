/**
 * Ask a machine where its daemon listens.
 *
 * `ssh <target> 'rove daemon status --json'` — and, when nothing is running
 * there, `rove daemon start` first. The answer carries the remote socket paths
 * verbatim, which is the whole point: the remote home may belong to a
 * different user, and `fitSocketPath` may have SHORTENED either path to fit
 * the platform's `sun_path` limit, so a path derived locally would be wrong in
 * two independent ways. Rove never guesses a remote socket path.
 */

import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import type { MachineConfig } from "./registry.ts"
import { machineSocketDir, machineSshArgs } from "./ssh-args.ts"

export interface RemoteDaemonStatus {
  readonly socketPath: string
  readonly ptySocketPath: string
  readonly homeDir: string
  readonly hostname: string
  readonly kobeVersion: string
  readonly daemonPid: number
}

export interface DiscoverResult {
  readonly ok: true
  readonly status: RemoteDaemonStatus
}
export interface DiscoverFailure {
  readonly ok: false
  readonly code: "SSH_FAILED" | "NO_ROVE" | "NO_DAEMON" | "BAD_STATUS"
  readonly message: string
}

/** Run one command on the machine. Never throws; a spawn failure is exit -1. */
export async function runOnMachine(
  alias: string,
  config: MachineConfig,
  command: string,
  opts: { readonly home?: string; readonly timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // The ControlPath's directory must exist before ssh tries to bind there.
  // Without it ssh reports `Control socket connect(...): No such file or
  // directory` — a message that names the .rove path and reads like a missing
  // Rove rather than a missing directory.
  try {
    mkdirSync(machineSocketDir(alias, opts.home), { recursive: true, mode: 0o700 })
  } catch {
    /* already there, or a filesystem without modes */
  }
  const argv = [...machineSshArgs(alias, config, { home: opts.home }), command]
  return await new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    const done = (exitCode: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode })
    }
    const child = spawn(argv[0] ?? "ssh", argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] })
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      stderr += "\ntimed out"
      done(-1)
    }, opts.timeoutMs ?? 30_000)
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString()
    })
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString()
    })
    child.on("error", () => done(-1))
    child.on("close", (code) => done(code ?? -1))
  })
}

/**
 * `rove daemon status --json`, starting the remote daemon once if none is up.
 *
 * Starting it is not overreach: a machine the user just registered is a
 * machine they want to see, and the remote daemon idle-stops on its own once
 * nothing is attached. Failure is classified rather than thrown so `machine
 * add` can say WHICH of the three things went wrong — unreachable host, Rove
 * not installed, daemon refused to start.
 */
export async function discoverMachine(
  alias: string,
  config: MachineConfig,
  opts: { readonly home?: string } = {},
): Promise<DiscoverResult | DiscoverFailure> {
  const first = await runOnMachine(alias, config, "rove daemon status --json", opts)
  const parsed = parseStatusJson(first.stdout)
  if (parsed) return { ok: true, status: parsed }
  const combined = `${first.stdout}\n${first.stderr}`.trim()
  // Match the SHELL's own "no such command" phrasings, anchored on the command
  // name. A bare `No such file or directory` is not enough: ssh says exactly
  // that about its own control socket, whose path contains `.rove`.
  if (/(?:^|\W)rove:? (?:command not found|not found)|command not found:? rove/i.test(combined)) {
    return {
      ok: false,
      code: "NO_ROVE",
      message: `Rove is not installed on ${alias} (or not on the non-interactive PATH). Install it there with \`npm i -g @sma1lboy/rove\`, then re-run.`,
    }
  }
  if (first.exitCode === 255 || first.exitCode === -1) {
    return { ok: false, code: "SSH_FAILED", message: `ssh to ${alias} failed: ${combined || "no output"}` }
  }
  // No daemon over there yet — start one and ask again.
  const started = await runOnMachine(alias, config, "rove daemon start", { ...opts, timeoutMs: 60_000 })
  const second = await runOnMachine(alias, config, "rove daemon status --json", opts)
  const retry = parseStatusJson(second.stdout)
  if (retry) return { ok: true, status: retry }
  // A remote Rove old enough to predate `ptySocketPath` answers `daemon
  // status` perfectly and still cannot be tunnelled — say so, rather than
  // reporting it as a daemon that would not start.
  if (looksLikeOldStatus(second.stdout)) {
    return {
      ok: false,
      code: "BAD_STATUS",
      message: `${alias} runs a Rove too old for machines (its \`daemon status\` reports no pty socket). Upgrade it: \`ssh ${alias} npm i -g @sma1lboy/rove\`.`,
    }
  }
  return {
    ok: false,
    code: started.exitCode === 0 ? "BAD_STATUS" : "NO_DAEMON",
    message: `could not read a daemon status from ${alias}: ${`${second.stdout}\n${second.stderr}\n${started.stderr}`.trim() || "no output"}`,
  }
}

/**
 * The first brace-balanced `{…}` run in a string, or null when there is none.
 *
 * A non-interactive `ssh` login prints on BOTH sides of a command's output — a
 * banner before, a "you have mail" or an rc-file echo after — and the daemon
 * status is a single JSON object somewhere in the middle. Scanning to the first
 * `{` skips a leading banner; slicing to its MATCHING `}` is what lets a
 * trailing line survive too, where a bare `JSON.parse(rest)` throws on it and
 * reports a healthy machine as "could not read a daemon status". Braces inside
 * string literals are skipped, so a socket path carrying a `{` cannot unbalance
 * the scan.
 */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{") depth++
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

/** A status payload that parses but predates `ptySocketPath`. */
export function looksLikeOldStatus(stdout: string): boolean {
  const json = firstJsonObject(stdout)
  if (json === null) return false
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    return typeof raw.socketPath === "string" && typeof raw.ptySocketPath !== "string"
  } catch {
    return false
  }
}

/**
 * Pull the status object out of a command's stdout.
 *
 * Tolerant of noise on BOTH sides of the JSON (a login banner or update notice
 * before, an rc-file echo or "you have mail" after) by extracting the first
 * brace-balanced object — a machine whose shell prints something on every
 * non-interactive login is common enough that being strict here would read as
 * "Rove is broken on that host". Returns null unless BOTH socket paths are
 * present, so an older remote Rove — which reports `socketPath` but not
 * `ptySocketPath` — is a clean "upgrade that machine" rather than a tunnel
 * that half-forwards.
 */
export function parseStatusJson(stdout: string): RemoteDaemonStatus | null {
  const json = firstJsonObject(stdout)
  if (json === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const socketPath = typeof o.socketPath === "string" ? o.socketPath : ""
  const ptySocketPath = typeof o.ptySocketPath === "string" ? o.ptySocketPath : ""
  if (!socketPath || !ptySocketPath) return null
  return {
    socketPath,
    ptySocketPath,
    homeDir: typeof o.homeDir === "string" ? o.homeDir : "",
    hostname: typeof o.hostname === "string" ? o.hostname : "",
    kobeVersion: typeof o.kobeVersion === "string" ? o.kobeVersion : "",
    daemonPid: typeof o.daemonPid === "number" ? o.daemonPid : 0,
  }
}
