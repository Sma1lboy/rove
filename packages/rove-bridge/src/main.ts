/**
 * rove-bridge — the Mac-side WebSocket gateway for the Rove iOS client.
 *
 *   bun src/main.ts [--preset tailscale|cf] [--port <n>] [--rotate-token]
 *
 * Off unless started. Listens on 127.0.0.1 by default. Remote access is one
 * of two presets: a tailnet address (`--preset tailscale`) or a Cloudflare
 * Tunnel guarded by Access (`--preset cf`). See README.md / docs/IOS.md.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { ensureDaemonReachable } from "@sma1lboy/rove-daemon/client/daemon-process"
import { ensurePtyHostReachable } from "@sma1lboy/rove-daemon/client/pty-process"
import { defaultPtyHostSocketPath } from "@sma1lboy/rove-daemon/daemon/paths"
import { resolveProductHomeDir } from "@sma1lboy/rove-daemon/daemon/product-paths"
import { RemoteOrchestrator } from "@sma1lboy/rove/src/client/remote-orchestrator.ts"
import { ensurePluginEnginesLoaded } from "@sma1lboy/rove/src/engine/plugin-engines.ts"
import { CURRENT_VERSION } from "@sma1lboy/rove/src/version.ts"
import { renderUnicodeCompact } from "uqr"
import { loadOrCreateToken, pairingUrl } from "./auth.ts"
import { createAccessVerifier } from "./cf-access.ts"
import { type BridgeArgs, type BridgeConfig, type TailscaleInfo, parseBridgeArgs } from "./cli-args.ts"
import { TaskFeed } from "./feed.ts"
import { createBridgeApi } from "./ops/api.ts"
import { createRoveOps } from "./rove-ops.ts"
import { type BridgeDeps, startBridgeServer } from "./server.ts"
import { usageStore } from "./usage-store.ts"

/** Re-read the list at least this often: group rules have time windows. */
const TICK_MS = 15_000

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

async function main(): Promise<void> {
  const home = resolveProductHomeDir()
  const bridgeDir = join(home, ".rove", "bridge")
  let args: BridgeArgs
  try {
    args = parseBridgeArgs(process.argv.slice(2), {
      config: readConfig(join(bridgeDir, "config.json")),
      tailscale: tailscaleInfo,
    })
  } catch (err) {
    console.error(`rove-bridge: ${err instanceof Error ? err.message : String(err)}`)
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
  const ops = createRoveOps(verbClient)
  const feed = new TaskFeed(() => ops.tasks())
  for (const signal of [
    orchestrator.tasksSignal(),
    orchestrator.engineStateSignal(),
    orchestrator.attentionInboxSignal(),
  ]) {
    signal.subscribe(() => feed.poke())
  }
  // Engine quota windows for `usage.get`; the daemon publishes them as the engines report.
  const usage = orchestrator.usageSnapshotSignal()
  usageStore.set(usage())
  usage.subscribe(() => usageStore.set(usage()))
  setInterval(() => feed.poke(), TICK_MS)

  const ptySocket = defaultPtyHostSocketPath()
  const deps: BridgeDeps = {
    token,
    ops,
    feed,
    openPty: () => new RoveDaemonClient(ptySocket),
    roveVersion: CURRENT_VERSION,
    api: createBridgeApi(verbClient),
    ...(args.cloudflare ? { access: createAccessVerifier(args.cloudflare) } : {}),
  }
  const servers = args.hosts.map((hostname) => startBridgeServer(deps, { hostname, port: args.port }))

  console.log(`rove-bridge ${CURRENT_VERSION} — Rove home ${home}`)
  for (const server of servers) {
    const host = server.hostname ?? "127.0.0.1"
    const port = server.port ?? args.port
    console.log(`listening on ${host}:${port}${args.preset === "none" ? "" : ` (preset ${args.preset})`}`)
    if (host === "0.0.0.0" || host === "::") {
      console.log("  WARNING: all interfaces, plain ws:// — prefer --preset tailscale or --preset cf")
    }
    const url = pairingUrl({ host: args.publicHost ?? host, port, token, tls: args.tls, preset: args.preset })
    console.log(`\npair: ${url}`)
    if (args.qr) console.log(renderUnicodeCompact(url))
  }
  if (args.cloudflare) {
    console.log(
      `\nCloudflare Access: team ${args.cloudflare.teamDomain}, every connection needs a valid JWT for this AUD.`,
    )
    console.log(`Point the tunnel at http://127.0.0.1:${args.port} (e.g. ingress service for ${args.publicHost}).`)
  }
  console.log("\nThe pairing URL is a password. `--rotate-token` revokes every paired phone.")
}

await main()
