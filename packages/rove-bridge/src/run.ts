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
import { RemoteOrchestrator } from "@sma1lboy/rove/src/client/remote-orchestrator.ts"
import { ensurePluginEnginesLoaded } from "@sma1lboy/rove/src/engine/plugin-engines.ts"
import { MachineHub } from "@sma1lboy/rove/src/machines/hub.ts"
import { CURRENT_VERSION } from "@sma1lboy/rove/src/version.ts"
import { renderUnicodeCompact } from "uqr"
import { loadOrCreateToken, pairingUrl, webUrl } from "./auth.ts"
import { createAccessVerifier } from "./cf-access.ts"
import { type BridgeArgs, type BridgeConfig, type TailscaleInfo, parseBridgeArgs } from "./cli-args.ts"
import { TaskFeed } from "./feed.ts"
import { NoticeFeed } from "./notices.ts"
import { createBridgeApi } from "./ops/api.ts"
import { machineStore } from "./ops/machines.ts"
import { createRoveOps } from "./rove-ops.ts"
import { type BridgeDeps, startBridgeServer } from "./server.ts"
import { TabFeed } from "./tab-feed.ts"
import { usageStore } from "./usage-store.ts"
import type { WebRoot } from "./web-static.ts"

/** Re-read the list at least this often: group rules have time windows. */
const TICK_MS = 15_000
/** The TUI rewrites state.json in bursts; one diff per burst. */
const TABS_DEBOUNCE_MS = 200

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

  const token = loadOrCreateToken(join(bridgeDir, "token"), args.rotateToken)

  const daemonSocket = await ensureDaemonReachable(undefined, "autospawn")
  await ensurePtyHostReachable()
  // `gui` role: a phone is a real UI, so the bridge holds the daemon alive
  // the way an open TUI does (a `pane` would let it idle-stop under the phone).
  const orchestrator = new RemoteOrchestrator(new RoveDaemonClient(daemonSocket), {
    role: "gui",
    graphicsOut: () => {},
  })
  await orchestrator.init()
  // Verbs get their own socket: some subscribe as a pane, which must not
  // demote the orchestrator's gui subscription.
  const verbClient = new RoveDaemonClient(daemonSocket)
  const ops = createRoveOps(verbClient, {
    changes: () => orchestrator.worktreeChangesSignal()(),
    tokens: () => orchestrator.rowTokensSignal()(),
  })
  const feed = new TaskFeed(() => ops.tasks())
  for (const signal of [
    orchestrator.tasksSignal(),
    orchestrator.engineStateSignal(),
    orchestrator.attentionInboxSignal(),
    orchestrator.worktreeChangesSignal(),
    orchestrator.rowTokensSignal(),
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
  // Other machines (`rove machine add`), as the TUI's sidebar: `attach()` is a no-op with none registered.
  const hub = new MachineHub(orchestrator)
  hub.attach()
  const machines = hub.machinesSignal()
  machineStore.set(machines.get())
  machines.subscribe(() => machineStore.set(machines.get()))
  setInterval(() => feed.poke(), TICK_MS)
  const notices = new NoticeFeed()
  const noticeStore = orchestrator.noticeStore()
  noticeStore.subscribe(() => notices.push(noticeStore.get()))
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
    tabs,
    openPty: () => new RoveDaemonClient(ptySocket),
    roveVersion: CURRENT_VERSION,
    api: createBridgeApi(verbClient),
    ...(args.cloudflare ? { access: createAccessVerifier(args.cloudflare) } : {}),
    ...(opts.web ? { web: opts.web } : {}),
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
