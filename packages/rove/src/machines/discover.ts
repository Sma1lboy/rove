/**
 * Ask a machine where its daemon listens.
 *
 * `ssh <target> 'rove daemon status --json'` (after `rove daemon restart` if
 * nothing runs). The answer carries the remote socket paths verbatim: the
 * remote home may be another user's, and `fitSocketPath` may have SHORTENED a
 * path for `sun_path`. Rove never guesses a remote socket path.
 */

import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { posix } from "node:path"
import { shQuote } from "../exec/exec-host.ts"
import { type MachineConfig, sshTargetOf } from "./registry.ts"
import { machineSocketDir, machineSshArgs } from "./ssh-args.ts"
import { type SshFailureKind, classifySshFailure, sshFailureRemedy } from "./ssh-failure.ts"
import {
  WINDOWS_LOCATE_ROVE,
  WINDOWS_ROVE_MISSING,
  WINDOWS_SCRIPTS_DISABLED,
  isWindowsPath,
  windowsNoRoveMessage,
  windowsRoveCommand,
} from "./windows-remote.ts"

export interface RemoteDaemonStatus {
  readonly socketPath: string
  readonly ptySocketPath: string
  readonly homeDir: string
  readonly hostname: string
  readonly roveVersion: string
  readonly daemonPid: number
  /** The machine's `rove` (not its daemon) accepts `daemon relay --preamble`. */
  readonly relayPreamble: boolean
}

export interface DiscoverResult {
  readonly ok: true
  readonly status: RemoteDaemonStatus
  /** Set when `rove` was found off the non-interactive PATH; persist it as `MachineConfig.roveBin`. */
  readonly roveBin?: string
}
export interface DiscoverFailure {
  readonly ok: false
  readonly code: "SSH_FAILED" | "NO_ROVE" | "NO_DAEMON" | "BAD_STATUS"
  readonly message: string
  /** The answer came from a Windows shell (cmd or PowerShell), not sh. */
  readonly windows?: boolean
  /** For `SSH_FAILED`: the cause read from ssh's stderr. */
  readonly ssh?: SshFailureKind
}

/** Run one command on the machine. Never throws; a spawn failure is exit -1. */
async function runOnMachine(
  alias: string,
  config: MachineConfig,
  command: string,
  opts: { readonly home?: string; readonly timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // The ControlPath's directory must exist first, else ssh's `Control socket
  // connect(...): No such file or directory` reads like a missing Rove.
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
 * Starting it is fine: the user just registered the machine, and the remote
 * daemon idle-stops once nothing is attached. Failure is classified, not
 * thrown, so `machine add` can say which: unreachable host, Rove not
 * installed, or daemon refused to start.
 *
 * A `rove` missing from the non-interactive PATH (the usual case for a
 * bun- or nvm-installed Rove: the rc file that adds it never runs) is looked
 * up once and reported back as `roveBin`, so nobody's rc file gets edited.
 */
export async function discoverMachine(
  alias: string,
  config: MachineConfig,
  opts: { readonly home?: string } = {},
): Promise<DiscoverResult | DiscoverFailure> {
  const found = await probe(alias, config, config.roveBin, opts)
  if (found.ok || found.code !== "NO_ROVE") return found
  const locate = found.windows ? WINDOWS_LOCATE_ROVE : LOCATE_ROVE_SCRIPT
  const located = parseLocatedRove((await runOnMachine(alias, config, locate, opts)).stdout)
  if (!located || located === config.roveBin) return found
  const retry = await probe(alias, config, located, opts)
  return retry.ok ? { ...retry, roveBin: located } : retry
}

/** What a successful probe teaches the registry about a machine. */
export function learnedFrom(found: DiscoverResult): {
  sockets: { daemon: string; pty: string }
  roveBin?: string
  relayPreamble?: true
} {
  return {
    sockets: { daemon: found.status.socketPath, pty: found.status.ptySocketPath },
    ...(found.roveBin ? { roveBin: found.roveBin } : {}),
    ...(found.status.relayPreamble ? { relayPreamble: true as const } : {}),
  }
}

/** `rove <args>` on the machine, in whatever shell its sshd runs. */
export function remoteRove(roveBin: string | undefined, args: readonly string[]): string {
  if (roveBin && isWindowsPath(roveBin)) return windowsRoveCommand(roveBin, args)
  return [roveCommand(roveBin), ...args].join(" ")
}

/**
 * The remote `rove` invocation. An absolute binary runs with its own
 * directory first on PATH: its shebang (`env bun`, `env node`) lives beside
 * it in every install layout that hides it from a non-interactive shell.
 */
export function roveCommand(roveBin: string | undefined): string {
  if (!roveBin) return "rove"
  return `PATH=${shQuote(posix.dirname(roveBin))}:"$PATH" ${shQuote(roveBin)}`
}

/** Asks the login shell first, then the install dirs bun, npm and nvm use. */
const LOCATE_ROVE_SCRIPT = [
  `p=$("\${SHELL:-sh}" -lc 'command -v rove' 2>/dev/null)`,
  `if [ -n "$p" ] && [ -x "$p" ]; then echo "ROVE_BIN=$p"; exit 0; fi`,
  `for p in "$HOME/.bun/bin/rove" "$HOME/.npm-global/bin/rove" "$HOME/.local/bin/rove" /opt/homebrew/bin/rove /usr/local/bin/rove "$HOME"/.nvm/versions/node/*/bin/rove; do`,
  `  if [ -x "$p" ]; then echo "ROVE_BIN=$p"; exit 0; fi`,
  "done",
  "exit 1",
].join("\n")

/** The `ROVE_BIN=` line a locate script prints; an absolute POSIX or Windows path, or nothing. */
export function parseLocatedRove(stdout: string): string | null {
  const match = /^ROVE_BIN=((?:\/|[A-Za-z]:\\)\S.*)$/m.exec(stdout)
  return match?.[1]?.trim() ?? null
}

/**
 * The shells' own "no such command" phrasings, anchored on the command name,
 * plus the "no such file" forms a stale absolute `roveBin` produces. A bare
 * `No such file or directory` is not enough: ssh says exactly that about its
 * own control socket, whose path contains `.rove`.
 */
const ROVE_MISSING =
  /(?:^|\W)rove:? (?:command not found|not found)|command not found:? rove|\/rove:? No such file or directory|no such file or directory: \S*\/rove\b/i

async function probe(
  alias: string,
  config: MachineConfig,
  roveBin: string | undefined,
  opts: { readonly home?: string },
): Promise<DiscoverResult | DiscoverFailure> {
  const status = remoteRove(roveBin, ["daemon", "status", "--json"])
  const first = await runOnMachine(alias, config, status, opts)
  const parsed = parseStatusJson(first.stdout)
  if (parsed) return windowsReady(alias, parsed)
  const combined = `${first.stdout}\n${first.stderr}`.trim()
  if (WINDOWS_ROVE_MISSING.test(combined) || WINDOWS_SCRIPTS_DISABLED.test(combined)) {
    return { ok: false, code: "NO_ROVE", windows: true, message: windowsNoRoveMessage(alias, combined) }
  }
  if (ROVE_MISSING.test(combined)) {
    return {
      ok: false,
      code: "NO_ROVE",
      message: `Rove is not installed on ${alias}: not on its PATH, its login shell's PATH, or the usual bun/npm/nvm install dirs. Install it there with \`npm i -g @sma1lboy/rove\`, then re-run.`,
    }
  }
  if (first.exitCode === 255 || first.exitCode === -1) {
    const ssh = classifySshFailure(first.stderr)
    const remedy = sshFailureRemedy(ssh, sshTargetOf(config))
    return {
      ok: false,
      code: "SSH_FAILED",
      ssh,
      message: ssh === "unknown" && combined ? `${remedy}\n${combined}` : remedy,
    }
  }
  // No daemon over there yet — start one and ask again. `restart` spawns it
  // detached; `start` would make this ssh session the daemon and never return.
  const started = await runOnMachine(alias, config, remoteRove(roveBin, ["daemon", "restart"]), {
    ...opts,
    timeoutMs: 60_000,
  })
  const second = await runOnMachine(alias, config, status, opts)
  const retry = parseStatusJson(second.stdout)
  if (retry) return windowsReady(alias, retry)
  // A remote Rove predating `ptySocketPath` answers but can't be tunnelled —
  // report that, not a daemon that would not start.
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
 * A Windows machine is reachable only through `rove daemon relay`, and its
 * PowerShell profile may print on every ssh command: a `rove` that cannot mark
 * where the relayed bytes start is too old to serve a hub from there.
 */
function windowsReady(alias: string, status: RemoteDaemonStatus): DiscoverResult | DiscoverFailure {
  if (status.relayPreamble || !isWindowsPath(status.socketPath)) return { ok: true, status }
  return {
    ok: false,
    code: "BAD_STATUS",
    message: `${alias} runs a Rove too old to serve another machine from Windows (rove ${status.roveVersion || "?"}; it needs \`rove daemon relay --preamble\`). Update it there: \`npm install -g @sma1lboy/rove\`.`,
  }
}

/**
 * The first brace-balanced `{…}` in `text`, or null. Matching the closing `}`
 * lets a trailing shell line survive; braces inside strings are skipped.
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
 * Extracts the first brace-balanced object to tolerate noise on both sides
 * (login banner or update notice before, rc-file echo or "you have mail"
 * after) — common on non-interactive logins. Returns null unless BOTH socket
 * paths are present, so an older remote Rove (no `ptySocketPath`) is a clean
 * "upgrade that machine", not a half-forwarding tunnel.
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
    roveVersion: statusVersion(o),
    daemonPid: typeof o.daemonPid === "number" ? o.daemonPid : 0,
    relayPreamble: o.relayPreamble === true,
  }
}

/** Daemons from before the rename report `kobeVersion`; naming it still explains a skew. */
function statusVersion(o: Record<string, unknown>): string {
  if (typeof o.roveVersion === "string") return o.roveVersion
  return typeof o.kobeVersion === "string" ? o.kobeVersion : ""
}
