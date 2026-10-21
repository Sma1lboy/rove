/**
 * A reverse SSH tunnel that outlives the shell that opened it. When machine B
 * cannot reach this machine (a WSL distro behind Windows NAT, a laptop behind
 * a home router), this machine dials B and keeps `127.0.0.1:<remotePort>` on B
 * pointed at its own sshd; B then registers this machine as
 * `rove machine add <user>@127.0.0.1:<remotePort>`.
 *
 * `rove machine tunnel <alias> --install` writes it as a systemd user service
 * (Linux) or a launchd agent (macOS) so the OS restarts it on drop and starts
 * it at login — no `while ssh …; do sleep; done` in a forgotten terminal.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { type MachineConfig, sshTargetOf } from "./registry.ts"

export interface ReverseTunnelPorts {
  /** Port on the OTHER machine's loopback that leads back here. */
  readonly remotePort: number
  /** This machine's sshd port. */
  readonly localPort: number
}

/** `ssh -N -R …` that fails fast (so the supervisor restarts it) and notices a dead link in ~45s. */
export function reverseTunnelArgv(config: MachineConfig, ports: ReverseTunnelPorts): string[] {
  const argv = [
    "ssh",
    "-N",
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "StrictHostKeyChecking=accept-new",
  ]
  if (config.port) argv.push("-p", String(config.port))
  if (config.auth.kind === "key" && config.auth.keyPath) argv.push("-i", config.auth.keyPath)
  argv.push("-R", `127.0.0.1:${ports.remotePort}:127.0.0.1:${ports.localPort}`, sshTargetOf(config))
  return argv
}

const unitName = (alias: string) => `rove-tunnel-${alias}`

/** Where the service file lives for this platform; null where Rove has no supervisor for it. */
export function tunnelServicePath(alias: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform === "linux") return join(homedir(), ".config", "systemd", "user", `${unitName(alias)}.service`)
  if (platform === "darwin") return join(homedir(), "Library", "LaunchAgents", `run.rove.tunnel.${alias}.plist`)
  return null
}

/** Resolve `ssh` to an absolute path: supervisors run with a minimal PATH. */
function absoluteSsh(argv: readonly string[]): string[] {
  const which = spawnSync("sh", ["-c", "command -v ssh"], { encoding: "utf8" })
  const ssh = which.status === 0 ? which.stdout.trim() : "/usr/bin/ssh"
  return [ssh, ...argv.slice(1)]
}

const shellQuote = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`)
const xml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export function systemdUnit(alias: string, argv: readonly string[]): string {
  return [
    "[Unit]",
    `Description=Rove reverse tunnel to ${alias}`,
    "After=network-online.target",
    "",
    "[Service]",
    `ExecStart=${argv.map(shellQuote).join(" ")}`,
    "Restart=always",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n")
}

export function launchdPlist(alias: string, argv: readonly string[]): string {
  const args = argv.map((a) => `    <string>${xml(a)}</string>`).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>run.rove.tunnel.${xml(alias)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
</dict>
</plist>
`
}

export interface TunnelInstallResult {
  readonly path: string
  readonly started: boolean
  readonly detail: string
}

function run(cmd: string, args: readonly string[]): { ok: boolean; out: string } {
  const res = spawnSync(cmd, args, { encoding: "utf8" })
  return { ok: res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim() }
}

/** Write the service file and start it now (and at every login). */
export function installReverseTunnel(
  alias: string,
  config: MachineConfig,
  ports: ReverseTunnelPorts,
): TunnelInstallResult {
  const path = tunnelServicePath(alias)
  if (!path)
    throw new Error(
      `no supported service manager on ${process.platform}; run \`${reverseTunnelArgv(config, ports).join(" ")}\` yourself`,
    )
  const argv = absoluteSsh(reverseTunnelArgv(config, ports))
  mkdirSync(dirname(path), { recursive: true })
  if (process.platform === "linux") {
    writeFileSync(path, systemdUnit(alias, argv))
    const reload = run("systemctl", ["--user", "daemon-reload"])
    if (!reload.ok) return { path, started: false, detail: `systemd user manager unavailable: ${reload.out}` }
    const start = run("systemctl", ["--user", "enable", "--now", `${unitName(alias)}.service`])
    return { path, started: start.ok, detail: start.out }
  }
  writeFileSync(path, launchdPlist(alias, argv))
  run("launchctl", ["unload", path])
  const load = run("launchctl", ["load", "-w", path])
  return { path, started: load.ok, detail: load.out }
}

/** Stop the service and remove its file. Absent is not an error. */
export function uninstallReverseTunnel(alias: string): string | null {
  const path = tunnelServicePath(alias)
  if (!path || !existsSync(path)) return null
  if (process.platform === "linux") {
    run("systemctl", ["--user", "disable", "--now", `${unitName(alias)}.service`])
    rmSync(path)
    run("systemctl", ["--user", "daemon-reload"])
  } else {
    run("launchctl", ["unload", "-w", path])
    rmSync(path)
  }
  return path
}
