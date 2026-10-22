/**
 * The bridge process body, shared by `bun src/main.ts` (phones only) and
 * `rove --web` (phones plus the browser client's static files). Off unless
 * started. Listens on 127.0.0.1 by default. Remote access is one of two
 * presets: a tailnet address (`--preset tailscale`) or a Cloudflare Tunnel
 * guarded by Access (`--preset cf`). See README.md / docs/IOS.md / docs/WEB.md.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { ensureDaemonReachable } from "@sma1lboy/rove-daemon/client/daemon-process"
import { ensurePtyHostReachable } from "@sma1lboy/rove-daemon/client/pty-process"
import { startFileWatchTrigger } from "@sma1lboy/rove-daemon/daemon/file-watch-trigger"
import { defaultPtyHostSocketPath } from "@sma1lboy/rove-daemon/daemon/paths"
import { defaultUiPrefsStatePath, resolveProductHomeDir } from "@sma1lboy/rove-daemon/daemon/product-paths"
import { executeVerb } from "@sma1lboy/rove/src/cli/api-cmd.ts"
import { REMOTE_CALLER } from "@sma1lboy/rove/src/cli/api/types.ts"
import { RemoteOrchestrator } from "@sma1lboy/rove/src/client/remote-orchestrator.ts"
import { ensurePluginEnginesLoaded } from "@sma1lboy/rove/src/engine/plugin-engines.ts"
import { MachineFeed } from "@sma1lboy/rove/src/machines/feed.ts"
import { forwardVerb, invokeRouted, machineDaemonSocket, requireMachine } from "@sma1lboy/rove/src/machines/forward.ts"
import { localPtySocketPath } from "@sma1lboy/rove/src/machines/ssh-args.ts"
import { CURRENT_VERSION } from "@sma1lboy/rove/src/version.ts"
import { renderUnicodeCompact } from "uqr"
import { addDevice, deviceOf, listDevices, loadOrCreateToken, pairingUrl, revokeDevice, webUrl } from "./auth.ts"
import { createAccessVerifier } from "./cf-access.ts"
import { type BridgeArgs, type BridgeConfig, type TailscaleInfo, parseBridgeArgs } from "./cli-args.ts"
import { DispatchFeed } from "./dispatch-feed.ts"
import { TaskFeed } from "./feed.ts"
import { NoticeFeed } from "./notices.ts"
import { createBridgeApi } from "./ops/api.ts"
import { machineStore } from "./ops/machines.ts"
import { runPasswordAction } from "./password-cmd.ts"
import { PromptFeed } from "./prompts.ts"
import { BridgeError } from "./protocol.ts"
import { createRoveOps } from "./rove-ops.ts"
import { RowStatusFeed } from "./row-status.ts"
import { type BridgeDeps, startBridgeServer } from "./server.ts"
import { TabFeed } from "./tab-feed.ts"
import { usageStore } from "./usage-store.ts"
import { createWebLogin } from "./web-login.ts"
import { readPassword, webPasswordPaths } from "./web-password.ts"
import type { WebRoot } from "./web-static.ts"

/** Re-read the list at least this often: group rules have time windows. */
const TICK_MS = 15_000
/** The TUI rewrites state.json in bursts; one diff per burst. */
const TABS_DEBOUNCE_MS = 200

/** Wait before reopening the row-status socket after the daemon dropped it. */
const STATUS_RECONNECT_MS = 1_000
const STATUS_RECONNECT_MAX_MS = 30_000

/** The Mac App Store build ships its CLI inside the app bundle. */
const TAILSCALE_BINARIES = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]

function tailscaleInfo(): TailscaleInfo {
  for (const bin of TAILSCALE_BINARIES) {
    const ip = spawnSync(bin, ["ip", "-4"], { encoding: "utf8", timeout: 5000 })
    const ipv4 = ip.status === 0 ? (ip.stdout.split("\n")[0]?.trim() ?? "") : ""
    if (!ipv4) continue
    const status = spawnSync(bin, ["status", "--json"], { encoding: "utf8", timeout: 5000 })
    let dnsName: string | null = null
    try {
      const self: unknown = JSON.parse(status.stdout).Self
      if (self && typeof self === "object" && "DNSName" in self && typeof self.DNSName === "string") {
        dnsName = self.DNSName.replace(/\.$/, "") || null
      }
    } catch {
      // MagicDNS name is a nicety; the IP is enough to pair.
    }
    return { ipv4, dnsName }
  }
  return { ipv4: null, dnsName: null }
}

function readConfig(path: string): BridgeConfig {
  if (!existsSync(path)) return {}
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!raw || typeof raw !== "object") throw new Error(`${path} must hold a JSON object`)
  const fields = new Map<string, unknown>(Object.entries(raw))
  const pick = (k: string): string | undefined => {
    const v = fields.get(k)
    return typeof v === "string" && v.trim() ? v.trim() : undefined
  }
  return { cfTeam: pick("cfTeam"), cfAud: pick("cfAud"), publicHost: pick("publicHost") }
}

export interface RunBridgeOptions {
  /** Name used in error lines (`rove-bridge`, `rove --web`). */
  readonly name: string
  /** Serve the browser client from here as well (`rove --web`). */
  readonly web?: WebRoot
}

/** Exits the process (code 2) on bad argv; otherwise keeps serving until killed. */
export async function runBridge(argv: readonly string[], opts: RunBridgeOptions): Promise<void> {
  const home = resolveProductHomeDir()
  const bridgeDir = join(home, ".rove", "bridge")
  let args: BridgeArgs
  try {
    args = parseBridgeArgs(argv, {
      config: readConfig(join(bridgeDir, "config.json")),
      tailscale: tailscaleInfo,
    })
  } catch (err) {
    console.error(`${opts.name}: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }

  // The bridge acts for the phone, not for whatever Rove tab launched it:
  // an inherited identity would stamp that tab as every new task's dispatcher.
  Reflect.deleteProperty(process.env, "ROVE_TASK_ID")
  Reflect.deleteProperty(process.env, "ROVE_TAB_ID")
  ensurePluginEnginesLoaded()

  const devicesPath = join(bridgeDir, "devices.json")
  if (args.action === "list-devices") {
    const devices = listDevices(devicesPath)
    console.log(devices.length ? devices.map((d) => `${d.name}  since ${d.createdAt}`).join("\n") : "no device tokens")
    return
  }
  if (args.action === "revoke-device") {
    const name = args.device ?? ""
    console.log(revokeDevice(devicesPath, name) ? `revoked ${name}` : `no device named ${name}`)
    return
  }
  if (args.action === "setup") {
    printSetup(args.port)
    return
  }
  if (args.action === "set-password" || args.action === "clear-password" || args.action === "unlock") {
    try {
      process.exitCode = await runPasswordAction(args.action, bridgeDir)
    } catch (err) {
      console.error(`${opts.name}: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    }
    return
  }
  const sharedToken = loadOrCreateToken(join(bridgeDir, "token"), args.rotateToken)
  // `--device` prints that device's own link; the bridge still accepts every valid token.
  const token = args.device ? addDevice(devicesPath, args.device) : sharedToken

  const daemonSocket = await ensureDaemonReachable(undefined, "autospawn")
  await ensurePtyHostReachable()
  // `gui` role: a phone is a real UI, so the bridge holds the daemon alive
  // the way an open TUI does (a `pane` would let it idle-stop under the phone).
  const orchestrator = new RemoteOrchestrator(new RoveDaemonClient(daemonSocket), {
    role: "gui",
    graphicsOut: () => {},
  })
  await orchestrator.init()
  // Other machines (`rove machine add`), as the daemon's hub publishes them.
  const hub = new MachineFeed(orchestrator)
  const machines = hub.machinesSignal()
  machineStore.set(machines.get())
  machines.subscribe(() => machineStore.set(machines.get()))
  // Verbs get their own socket: some subscribe as a pane, which must not
  // demote the orchestrator's gui subscription.
  const verbClient = new RoveDaemonClient(daemonSocket)
  // A task the hub lists under another machine: its verbs run there, its terminal is that machine's PTY host.
  const machineOf = (taskId: string): string | undefined => {
    const task = hub
      .tasksSignal()
      .get()
      .find((row) => String(row.id) === taskId)
    const alias = task?.origin?.machineId
    return alias && alias !== "local" ? alias : undefined
  }
  // The daemon's row status gets its own socket too: `ui.viewing` is keyed by connection, and the
  // daemon clears a connection's reports when it closes, so this one lives as long as the bridge.
  const statusClient = new RoveDaemonClient(daemonSocket)
  const rowStatus = new RowStatusFeed(statusClient)
  // Same socket: like row status, it is a whole snapshot to resync after the daemon comes back.
  const dispatches = new DispatchFeed(statusClient)
  let statusRetryMs = STATUS_RECONNECT_MS
  const syncStatus = async (): Promise<void> => {
    try {
      await statusClient.subscribe({ channels: ["row.status", "dispatch.snapshot"], role: "pane" })
      await rowStatus.resync()
      await dispatches.resync()
      statusRetryMs = STATUS_RECONNECT_MS
    } catch {
      // Daemon mid-restart: try again, backing off while it stays away.
      statusClient.forceDisconnect()
      setTimeout(() => void syncStatus(), statusRetryMs)
      statusRetryMs = Math.min(statusRetryMs * 2, STATUS_RECONNECT_MAX_MS)
    }
  }
  statusClient.onLifecycle("close", () => {
    setTimeout(() => void syncStatus(), STATUS_RECONNECT_MS)
  })
  await syncStatus()
  const api = createBridgeApi(verbClient, {
    machineOf,
    forward: (alias, verb, params) => forwardVerb(requireMachine(alias), verb, params),
  })
  const ops = createRoveOps(
    verbClient,
    {
      changes: () => orchestrator.worktreeChangesSignal()(),
      tokens: () => orchestrator.rowTokensSignal()(),
      gates: () => orchestrator.gatesSignal()(),
      remote: () =>
        hub
          .tasksSignal()
          .get()
          .filter((task) => task.origin && task.origin.machineId !== "local")
          .map((task) => ({ ...task, kind: task.kind ?? "task", pinned: task.pinned ?? false })),
      remoteLive: () => hub.liveSignal().get(),
      rowStatus: () => rowStatus.current(),
    },
    api,
  )
  const feed = new TaskFeed(() => ops.tasks())
  for (const signal of [
    orchestrator.tasksSignal(),
    rowStatus,
    orchestrator.attentionInboxSignal(),
    orchestrator.worktreeChangesSignal(),
    orchestrator.rowTokensSignal(),
    orchestrator.gatesSignal(),
    hub.tasksSignal(),
    hub.liveSignal(),
  ]) {
    signal.subscribe(() => feed.poke())
  }
  // Engine quota windows for `usage.get`; the daemon publishes them as the engines report.
  const usage = orchestrator.usageSnapshotSignal()
  usageStore.set(usage())
  usage.subscribe(() => usageStore.set(usage()))
  const context = orchestrator.contextUsageSignal()
  usageStore.setContext(context())
  context.subscribe(() => usageStore.setContext(context()))
  setInterval(() => feed.poke(), TICK_MS)
  const notices = new NoticeFeed()
  const noticeStore = orchestrator.noticeStore()
  noticeStore.subscribe(() => notices.push(noticeStore.get()))
  const prompts = new PromptFeed()
  const promptStore = orchestrator.uiPromptStore()
  promptStore.subscribe(() => prompts.push(promptStore.get()))
  const modPanes = orchestrator.modPanesSignal()
  const mods: BridgeDeps["mods"] = {
    current: () => modPanes.get(),
    subscribe: (listener) => modPanes.subscribe(() => listener(modPanes.get())),
  }
  const statePath = defaultUiPrefsStatePath()
  const readState = (): Record<string, unknown> => {
    try {
      const raw: unknown = JSON.parse(readFileSync(statePath, "utf8"))
      return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  const tabs = new TabFeed(readState)
  startFileWatchTrigger({
    filePath: statePath,
    debounceMs: TABS_DEBOUNCE_MS,
    onTrigger: () => tabs.check(),
    // Best-effort: the next write re-checks.
    onError: () => {},
  })

  const ptySocket = defaultPtyHostSocketPath()
  const deps: BridgeDeps = {
    token,
    ops,
    feed,
    notices,
    prompts,
    mods,
    tabs,
    rowStatus,
    dispatches,
    deviceOf: (presented) => deviceOf(devicesPath, presented),
    openPty: () => new RoveDaemonClient(ptySocket),
    openMachinePty: async (alias) => {
      const entry = requireMachine(alias)
      // Both forwards go up together: a live daemon socket means the PTY socket is live too.
      if (!(await machineDaemonSocket(entry))) {
        throw new BridgeError("MACHINE_UNREACHABLE", `machine "${alias}" did not answer`)
      }
      return new RoveDaemonClient(localPtySocketPath(alias))
    },
    roveVersion: CURRENT_VERSION,
    api,
    invoke: (verb, params, machine) =>
      invokeRouted({
        verb,
        params,
        machine,
        isLocalTask: (id) =>
          verbClient.request("task.get", { taskId: id }).then(
            () => true,
            () => false,
          ),
        runHere: () => executeVerb(verb, { params }, { client: verbClient, caller: REMOTE_CALLER }),
      }),
    ...(args.cloudflare ? { access: createAccessVerifier(args.cloudflare) } : {}),
    ...(opts.web ? { web: opts.web } : {}),
    ...(opts.web
      ? {
          login: createWebLogin({
            bridgeDir,
            devicesPath,
            publicHost: args.publicHost,
            trustForwardedIp: args.preset === "cf" || (args.preset === "none" && args.publicHost !== null),
            log: (line) => console.error(line),
          }),
        }
      : {}),
    publicHost: args.publicHost,
  }
  const servers = args.hosts.map((hostname) => {
    try {
      return startBridgeServer(deps, { hostname, port: args.port })
    } catch (err) {
      if (!(err && typeof err === "object" && "code" in err && err.code === "EADDRINUSE")) throw err
      console.error(
        `${opts.name}: ${hostname}:${args.port} is already in use (another rove-bridge?). Stop it or pass --port <n>.`,
      )
      process.exit(2)
    }
  })

  console.log(`${opts.name} ${CURRENT_VERSION} — Rove home ${home}`)
  for (const server of servers) {
    const host = server.hostname ?? "127.0.0.1"
    const port = server.port ?? args.port
    console.log(`listening on ${host}:${port}${args.preset === "none" ? "" : ` (preset ${args.preset})`}`)
    if (host === "0.0.0.0" || host === "::") {
      console.log("  WARNING: all interfaces, plain ws:// — prefer --preset tailscale or --preset cf")
    }
    const publicHost = args.publicHost ?? host
    if (opts.web) console.log(`\nopen: ${webUrl({ host: publicHost, port, token, tls: args.tls })}`)
    if (opts.web && readPassword(webPasswordPaths(bridgeDir).password)) {
      console.log(`password login: on at ${webUrl({ host: publicHost, port, token: "", tls: args.tls }).split("#")[0]}`)
    }
    const url = pairingUrl({ host: publicHost, port, token, tls: args.tls, preset: args.preset })
    console.log(`${opts.web ? "" : "\n"}pair: ${url}`)
    if (args.qr && !opts.web) console.log(renderUnicodeCompact(url))
  }
  if (args.cloudflare) {
    console.log(
      `\nCloudflare Access: team ${args.cloudflare.teamDomain}, every connection needs a valid JWT for this AUD.`,
    )
    console.log(`Point the tunnel at http://127.0.0.1:${args.port} (e.g. ingress service for ${args.publicHost}).`)
  }
  console.log(
    `\nThe ${opts.web ? "links are passwords" : "pairing URL is a password"}. \`--rotate-token\` revokes every paired phone${opts.web ? " and browser" : ""}.`,
  )
}

/**
 * `--setup`: what reaching this bridge from a phone takes, checked against this machine. It only
 * reads (`tailscale status`, `cloudflared --version`) and prints commands; it exposes nothing.
 */
function printSetup(port: number): void {
  const has = (cmd: string, args: readonly string[]) => {
    const res = spawnSync(cmd, args, { encoding: "utf8" })
    return res.status === 0 ? (res.stdout ?? "").trim() : null
  }
  const ts = has("tailscale", ["status", "--json"])
  const cf = has("cloudflared", ["--version"])
  const lines = ["Reaching this bridge from another device:", ""]
  if (ts) {
    lines.push(
      "  Tailscale is up here. Private to your tailnet:",
      `    rove --web --preset tailscale --port ${port}`,
      "  With HTTPS on your MagicDNS name (needed for a phone browser):",
      `    tailscale serve --bg ${port}   then   rove --web --preset tailscale --public-host <this-machine>.<tailnet>.ts.net`,
    )
  } else lines.push("  Tailscale: not running here (https://tailscale.com/download), the simplest private path.")
  lines.push("")
  if (cf) {
    lines.push(
      `  cloudflared is installed (${cf.split("\n")[0]}). Behind Cloudflare Access:`,
      `    cloudflared tunnel --url http://127.0.0.1:${port}   (or a named tunnel to your hostname)`,
      "    rove --web --preset cf --public-host <hostname> --cf-team <team> --cf-aud <aud>",
    )
  } else lines.push("  cloudflared: not installed; only needed to publish through Cloudflare Access.")
  lines.push("", "  Give each phone its own token: rove --web --device <name>; revoke one with --revoke-device <name>.")
  console.log(lines.join("\n"))
}
