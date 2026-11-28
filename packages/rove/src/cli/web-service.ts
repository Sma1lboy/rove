/**
 * `rove --web --install` / `--uninstall` / `--stop` / `--start`: keep `rove --web` running as a login service (a launchd agent on macOS, a
 * systemd user unit on Linux), restarted when it dies, logging to `<home>/.rove/bridge/web.log`. It dials the relay
 * a phone pairs through, so the phone reaches this computer whenever it is on, with no terminal left open.
 */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
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
/**
 * One service per Rove home: a sandbox or second home (`ROVE_HOME_DIR`) gets its own name, so installing there never
 * replaces the default home's service, which lives in the same `~/Library/LaunchAgents` or systemd directory.
 */
export function serviceNames(roveHome: string | undefined): { label: string; unit: string } {
  if (!roveHome) return { label: WEB_SERVICE.launchdLabel, unit: "rove-web.service" }
  const tag = createHash("sha256").update(roveHome).digest("hex").slice(0, 8)
  return { label: `${WEB_SERVICE.launchdLabel}.${tag}`, unit: `rove-web-${tag}.service` }
}

const names = () => serviceNames(readRoveHomeDirEnv())

function servicePath(platform: NodeJS.Platform): string | null {
  if (platform === "linux") return join(homedir(), ".config", "systemd", "user", names().unit)
  if (platform === "darwin") return join(homedir(), "Library", "LaunchAgents", `${names().label}.plist`)
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
  const service = { ...withFlags(flags), launchdLabel: names().label }
  writeFileSync(path, platform === "linux" ? systemdUnit(ctx, service) : launchdPlist(ctx, service))
  if (platform === "darwin") {
    run("launchctl", ["bootout", `${gui()}/${names().label}`])
    const load = run("launchctl", ["bootstrap", gui(), path])
    if (!load.ok) throw new Error(`wrote ${path}, but launchd did not load it: ${load.out}`)
  } else {
    const reload = run("systemctl", ["--user", "daemon-reload"])
    const enable = reload.ok ? run("systemctl", ["--user", "enable", "--now", names().unit]) : reload
    if (!enable.ok) throw new Error(`wrote ${path}, but systemd did not start it: ${enable.out}`)
  }
  return `rove --web now runs in the background and starts when you log in (${path}).\nLog: ${ctx.logPath}\nPair a phone in the page's Settings → Connectors → Phone, or from the link in the log.`
}

function uninstall(platform: NodeJS.Platform): string {
  const path = servicePath(platform)
  if (!path || !existsSync(path)) return "rove --web is not installed as a login service."
  if (platform === "darwin") run("launchctl", ["bootout", `${gui()}/${names().label}`])
  else run("systemctl", ["--user", "disable", "--now", names().unit])
  rmSync(path)
  if (platform === "linux") run("systemctl", ["--user", "daemon-reload"])
  return `Stopped and removed the rove --web login service (${path}).`
}

/** Stops the service now; it stays installed and comes back at the next login, or with `--start`. */
function stop(platform: NodeJS.Platform): string {
  const path = servicePath(platform)
  if (!path || !existsSync(path))
    return "rove --web is not installed as a login service; stop a terminal run with Ctrl-C."
  const res =
    platform === "darwin"
      ? run("launchctl", ["bootout", `${gui()}/${names().label}`])
      : run("systemctl", ["--user", "stop", names().unit])
  // launchd answers "No such process" when it was already stopped.
  if (!res.ok && !/no such process|not loaded|could not find/i.test(res.out))
    throw new Error(`could not stop it: ${res.out}`)
  return "Stopped rove --web. It starts again at your next login, or now with `rove --web --start`; `--uninstall` removes it."
}

function start(platform: NodeJS.Platform): string {
  const path = servicePath(platform)
  if (!path || !existsSync(path)) return "rove --web is not installed as a login service: run `rove --web --install`."
  const res =
    platform === "darwin"
      ? run("launchctl", ["bootstrap", gui(), path])
      : run("systemctl", ["--user", "start", names().unit])
  // Bootstrapping a loaded service fails with "already" / EIO (5): it is running, which is what was asked.
  if (!res.ok && !/already|input\/output error/i.test(res.out)) throw new Error(`could not start it: ${res.out}`)
  return `rove --web is running. Log: ${context().logPath}`
}

/** Handles `--install` / `--uninstall` / `--stop` / `--start`; false when `args` asks for none. */
export async function webServiceCommand(args: readonly string[], platform = process.platform): Promise<boolean> {
  if (argvHasFlag(args, "--uninstall")) {
    console.log(uninstall(platform))
    return true
  }
  if (argvHasFlag(args, "--stop")) {
    console.log(stop(platform))
    return true
  }
  if (argvHasFlag(args, "--start")) {
    console.log(start(platform))
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
