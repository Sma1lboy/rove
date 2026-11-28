/**
 * `rove daemon autostart [on|off]`: bring the daemon up, resident, when its user logs in, so a
 * machine that rebooted is reachable again without anyone opening Rove on it.
 *
 * Linux and macOS register the foreground `daemon start --resident` with the user's service manager.
 * Windows has none a user can write to without elevation, so a per-user Run entry starts the daemon
 * through the detached launcher instead (`autostart run`).
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { roveCliInvocation } from "@sma1lboy/rove-core/lib/invocation.ts"
import { ROVE_PRODUCT_NAME } from "@sma1lboy/rove-core/product.ts"
import { ensureDaemonReachable, resolveRoveSpawn } from "@sma1lboy/rove-daemon/client/daemon-process"
import { readRoveHomeDirEnv } from "@sma1lboy/rove-daemon/compat-env"
import { defaultDaemonLogPath } from "@sma1lboy/rove-daemon/daemon/paths"
import { shellQuote, xml } from "../machines/reverse-tunnel.ts"

const CLI_NAME = ROVE_PRODUCT_NAME
const LAUNCHD_LABEL = "run.rove.daemon"
const SYSTEMD_UNIT = "rove.service"
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
const RUN_VALUE = "Rove"

export interface AutostartContext {
  /** What runs this Rove install, without a subcommand. */
  readonly cli: readonly string[]
  /** The installing shell's PATH (a service manager's own is too short to find git, gh or an engine) and its Rove home when one is set. */
  readonly env: Readonly<Record<string, string>>
  readonly logPath: string
}

/** A login service: what it runs, its name, and whether the service manager restarts it when it dies. */
export interface LoginService {
  readonly description: string
  readonly launchdLabel: string
  readonly args: readonly string[]
  /** The daemon is not: `rove daemon restart` replaces it itself. The web bridge is: nothing else would. */
  readonly keepAlive: boolean
}

const DAEMON_SERVICE: LoginService = {
  description: "Rove daemon",
  launchdLabel: LAUNCHD_LABEL,
  args: ["daemon", "start", "--resident"],
  keepAlive: false,
}

export function systemdUnit(ctx: AutostartContext, service: LoginService): string {
  return [
    "[Unit]",
    `Description=${service.description}`,
    "",
    "[Service]",
    `ExecStart=${[...ctx.cli, ...service.args].map(shellQuote).join(" ")}`,
    ...Object.entries(ctx.env).map(([name, value]) => `Environment=${shellQuote(`${name}=${value}`)}`),
    `StandardOutput=append:${ctx.logPath}`,
    `StandardError=append:${ctx.logPath}`,
    "Restart=on-failure",
    ...(service.keepAlive ? ["RestartSec=10"] : []),
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n")
}

export function launchdPlist(ctx: AutostartContext, service: LoginService): string {
  const args = [...ctx.cli, ...service.args].map((a) => `    <string>${xml(a)}</string>`).join("\n")
  const env = Object.entries(ctx.env)
    .map(([name, value]) => `    <key>${xml(name)}</key>\n    <string>${xml(value)}</string>`)
    .join("\n")
  const keepAlive = service.keepAlive
    ? `
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>`
    : ""
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${service.launchdLabel}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key>
  <true/>${keepAlive}
  <key>StandardOutPath</key>
  <string>${xml(ctx.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(ctx.logPath)}</string>
</dict>
</plist>
`
}

export const systemdDaemonUnit = (ctx: AutostartContext): string => systemdUnit(ctx, DAEMON_SERVICE)

/** Started once at login and not kept alive: `rove daemon restart` replaces the daemon itself. */
export const launchdDaemonPlist = (ctx: AutostartContext): string => launchdPlist(ctx, DAEMON_SERVICE)

/** `conhost --headless` gives the short-lived launcher a console nobody sees. */
export function windowsRunCommand(ctx: AutostartContext): string {
  const quote = (arg: string) => (/[\s"]/.test(arg) ? `"${arg}"` : arg)
  return ["conhost.exe", "--headless", ...[...ctx.cli, "daemon", "autostart", "run"].map(quote)].join(" ")
}

function servicePath(platform: NodeJS.Platform): string | null {
  if (platform === "linux") return join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT)
  if (platform === "darwin") return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`)
  return null
}

function run(cmd: string, args: readonly string[]): { ok: boolean; out: string } {
  const res = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true })
  return { ok: res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim() }
}

function context(): AutostartContext {
  const home = readRoveHomeDirEnv()
  return {
    cli: roveCliInvocation({ sameInstall: true }),
    env: { PATH: process.env.PATH ?? "", ...(home ? { ROVE_HOME_DIR: home } : {}) },
    logPath: defaultDaemonLogPath(),
  }
}

/** The command registered to run at login; null when autostart is off. */
export function autostartEntry(platform: NodeJS.Platform = process.platform): string | null {
  if (platform === "win32") {
    const query = run("reg.exe", ["query", RUN_KEY, "/v", RUN_VALUE])
    return query.ok ? (/REG_SZ\s+(.*)$/m.exec(query.out)?.[1]?.trim() ?? RUN_VALUE) : null
  }
  const path = servicePath(platform)
  return path && existsSync(path) ? path : null
}

/** Register the login entry. Returns one line saying where it went, plus what still needs the user. */
export function enableAutostart(platform: NodeJS.Platform = process.platform): string {
  const ctx = context()
  if (platform === "win32") {
    const add = run("reg.exe", ["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", windowsRunCommand(ctx), "/f"])
    if (!add.ok) throw new Error(`could not write the Run entry: ${add.out}`)
    return `the daemon starts when you sign in to Windows (${RUN_KEY}\\${RUN_VALUE})`
  }
  const path = servicePath(platform)
  if (!path) throw new Error(`no login service ${CLI_NAME} can write on ${platform}`)
  const body = platform === "linux" ? systemdDaemonUnit(ctx) : launchdDaemonPlist(ctx)
  // A unit written by hand is the owner's: say so and leave it.
  if (existsSync(path) && !readFileSync(path, "utf8").includes("daemon start")) {
    throw new Error(`${path} exists and does not start the ${CLI_NAME} daemon; move it away first`)
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
  if (platform === "darwin") return `the daemon starts when you log in (${path})`
  const reload = run("systemctl", ["--user", "daemon-reload"])
  const enable = reload.ok ? run("systemctl", ["--user", "enable", SYSTEMD_UNIT]) : reload
  if (!enable.ok) throw new Error(`wrote ${path}, but systemd did not enable it: ${enable.out}`)
  return `the daemon starts when you log in (${path}). To start it at boot, before any login: loginctl enable-linger $USER`
}

/** Remove the login entry; false when there was none. The running daemon is left alone. */
export function disableAutostart(platform: NodeJS.Platform = process.platform): boolean {
  if (autostartEntry(platform) === null) return false
  if (platform === "win32") return run("reg.exe", ["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]).ok
  const path = servicePath(platform) as string
  if (platform === "linux") run("systemctl", ["--user", "disable", SYSTEMD_UNIT])
  rmSync(path)
  if (platform === "linux") run("systemctl", ["--user", "daemon-reload"])
  return true
}

/** What the Windows Run entry calls: start the daemon detached and resident unless one already answers. */
export async function runAutostart(): Promise<void> {
  await ensureDaemonReachable((subcommand) => [...resolveRoveSpawn(subcommand), "--resident"])
}

export async function autostartCommand(argv: readonly string[]): Promise<void> {
  const [action = "status", ...rest] = argv
  if (rest.length > 0 || !["status", "on", "off", "run"].includes(action)) {
    process.stderr.write(`Usage: ${CLI_NAME} daemon autostart [on|off]\n`)
    process.exit(2)
  }
  if (action === "run") return runAutostart()
  try {
    if (action === "on") console.log(`${CLI_NAME} daemon: ${enableAutostart()}`)
    else if (action === "off") {
      console.log(
        disableAutostart()
          ? `${CLI_NAME} daemon: autostart is off. The running daemon was left alone.`
          : `${CLI_NAME} daemon: autostart was not on`,
      )
    } else {
      const entry = autostartEntry()
      console.log(`${CLI_NAME} daemon: autostart is ${entry ? `on (${entry})` : "off"}`)
    }
  } catch (err) {
    process.stderr.write(`${CLI_NAME} daemon: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}
