/**
 * `rove --web --install` / `--uninstall`: keep `rove --web` running as a login service (a launchd agent on macOS, a
 * systemd user unit on Linux), restarted when it dies, logging to `<home>/.rove/bridge/web.log`. It dials the relay
 * a phone pairs through, so the phone reaches this computer whenever it is on, with no terminal left open.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { readRoveHomeDirEnv } from "@sma1lboy/rove-daemon/compat-env"
import { defaultDaemonLogPath } from "@sma1lboy/rove-daemon/daemon/paths"
import { argvHasFlag } from "./argv.ts"
import { type AutostartContext, type LoginService, launchdPlist, systemdUnit } from "./daemon-autostart.ts"
import { roveCliInvocation } from "./invocation.ts"

export const WEB_SERVICE: LoginService = {
  description: "Rove web (rove --web)",
  launchdLabel: "run.rove.web",
  args: ["--web"],
  keepAlive: true,
}

/** The service runs `rove --web` with the flags given after `--install` (`--port 7979`). */
const withFlags = (flags: readonly string[]): LoginService => ({
  ...WEB_SERVICE,
  args: [...WEB_SERVICE.args, ...flags],
})
const SYSTEMD_UNIT = "rove-web.service"

function servicePath(platform: NodeJS.Platform): string | null {
  if (platform === "linux") return join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT)
  if (platform === "darwin") return join(homedir(), "Library", "LaunchAgents", `${WEB_SERVICE.launchdLabel}.plist`)
  return null
}

function run(cmd: string, args: readonly string[]): { ok: boolean; out: string } {
  const res = spawnSync(cmd, args, { encoding: "utf8" })
  return { ok: res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim() }
}

function context(): AutostartContext {
  const home = readRoveHomeDirEnv()
  return {
    cli: roveCliInvocation({ sameInstall: true }),
    env: { PATH: process.env.PATH ?? "", ...(home ? { ROVE_HOME_DIR: home } : {}) },
    logPath: join(dirname(defaultDaemonLogPath()), "bridge", "web.log"),
  }
}

const gui = () => `gui/${process.getuid?.() ?? 0}`

/** Writes the service, starts it now, and says where it went. */
async function install(platform: NodeJS.Platform, flags: readonly string[]): Promise<string> {
  const path = servicePath(platform)
  if (!path) throw new Error(`no login service can be written on ${platform}; run \`rove --web\` in a terminal`)
  // A unit written by hand is the owner's: say so and leave it. Ours names its label (plist) or description (unit).
  const existing = existsSync(path) ? readFileSync(path, "utf8") : null
  if (
    existing !== null &&
    !existing.includes(WEB_SERVICE.launchdLabel) &&
    !existing.includes(WEB_SERVICE.description)
  ) {
    throw new Error(`${path} exists and does not run rove --web; move it away first`)
  }
  const ctx = context()
  // No preset needed: the saved relay keeps the phone's way in, and this computer's own
  // browser still opens without a token.
  const bridge = await import("rove-bridge")
  const configPath = join(dirname(defaultDaemonLogPath()), "bridge", "config.json")
  const saved: unknown = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {}
  if (!(saved && typeof saved === "object" && "relayServer" in saved)) {
    bridge.saveRelayServer(configPath, bridge.DEFAULT_RELAY_SERVER)
  }
  mkdirSync(dirname(path), { recursive: true })
  mkdirSync(dirname(ctx.logPath), { recursive: true, mode: 0o700 })
  const service = withFlags(flags)
  writeFileSync(path, platform === "linux" ? systemdUnit(ctx, service) : launchdPlist(ctx, service))
  if (platform === "darwin") {
    run("launchctl", ["bootout", `${gui()}/${WEB_SERVICE.launchdLabel}`])
    const load = run("launchctl", ["bootstrap", gui(), path])
    if (!load.ok) throw new Error(`wrote ${path}, but launchd did not load it: ${load.out}`)
  } else {
    const reload = run("systemctl", ["--user", "daemon-reload"])
    const enable = reload.ok ? run("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT]) : reload
    if (!enable.ok) throw new Error(`wrote ${path}, but systemd did not start it: ${enable.out}`)
  }
  return `rove --web now runs in the background and starts when you log in (${path}).\nLog: ${ctx.logPath}\nPair a phone in the page's Settings → Connectors → Phone, or from the link in the log.`
}

function uninstall(platform: NodeJS.Platform): string {
  const path = servicePath(platform)
  if (!path || !existsSync(path)) return "rove --web is not installed as a login service."
  if (platform === "darwin") run("launchctl", ["bootout", `${gui()}/${WEB_SERVICE.launchdLabel}`])
  else run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT])
  rmSync(path)
  if (platform === "linux") run("systemctl", ["--user", "daemon-reload"])
  return `Stopped and removed the rove --web login service (${path}).`
}

/** Handles `--install` / `--uninstall`; false when `args` asks for neither. */
export async function webServiceCommand(args: readonly string[], platform = process.platform): Promise<boolean> {
  if (argvHasFlag(args, "--uninstall")) {
    console.log(uninstall(platform))
    return true
  }
  if (!argvHasFlag(args, "--install")) return false
  console.log(
    await install(
      platform,
      args.filter((arg) => arg !== "--install"),
    ),
  )
  return true
}
