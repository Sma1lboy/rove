/**
 * rove-bridge — the Mac-side WebSocket gateway for the Rove iOS client.
 *
 *   bun src/main.ts [--host <addr>]... [--port <n>] [--rotate-token]
 *
 * Off unless started. Listens on 127.0.0.1 by default; every other interface
 * (a LAN or Tailscale address, or 0.0.0.0) is an explicit `--host`.
 */

import { networkInterfaces } from "node:os"
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
import { type BridgeArgs, parseBridgeArgs } from "./cli-args.ts"
import { TaskFeed } from "./feed.ts"
import { createRoveOps } from "./rove-ops.ts"
import { startBridgeServer } from "./server.ts"

/** Re-read the list at least this often: group rules have time windows. */
const TICK_MS = 15_000

/** Addresses a phone can dial when bound to a wildcard; Tailscale first. */
function reachableAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === "IPv4" && !addr.internal) out.push(addr.address)
    }
  }
  return out.sort((a, b) => Number(b.startsWith("100.")) - Number(a.startsWith("100.")))
}

async function main(): Promise<void> {
  let args: BridgeArgs
  try {
    args = parseBridgeArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`rove-bridge: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }

  // The bridge acts for the phone, not for whatever Rove tab launched it:
  // an inherited identity would stamp that tab as every new task's dispatcher.
  Reflect.deleteProperty(process.env, "ROVE_TASK_ID")
  Reflect.deleteProperty(process.env, "ROVE_TAB_ID")
  ensurePluginEnginesLoaded()

  const home = resolveProductHomeDir()
  const token = loadOrCreateToken(join(home, ".rove", "bridge", "token"), args.rotateToken)

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
  const ops = createRoveOps(new RoveDaemonClient(daemonSocket))
  const feed = new TaskFeed(() => ops.tasks())
  for (const signal of [
    orchestrator.tasksSignal(),
    orchestrator.engineStateSignal(),
    orchestrator.attentionInboxSignal(),
  ]) {
    signal.subscribe(() => feed.poke())
  }
  setInterval(() => feed.poke(), TICK_MS)

  const ptySocket = defaultPtyHostSocketPath()
  const deps = {
    token,
    ops,
    feed,
    openPty: () => new RoveDaemonClient(ptySocket),
    roveVersion: CURRENT_VERSION,
  }
  const servers = args.hosts.map((hostname) => startBridgeServer(deps, { hostname, port: args.port }))

  console.log(`rove-bridge ${CURRENT_VERSION} — Rove home ${home}`)
  for (const server of servers) {
    const host = server.hostname ?? "127.0.0.1"
    const dialable = host === "0.0.0.0" || host === "::" ? reachableAddresses() : [host]
    if (host === "0.0.0.0" || host === "::") {
      console.log(`listening on ALL interfaces (${host}:${server.port}) — anyone on these networks can try the token`)
    } else {
      console.log(`listening on ${host}:${server.port}`)
    }
    for (const addr of dialable) {
      const url = pairingUrl(addr, server.port ?? args.port, token)
      console.log(`\npair: ${url}`)
      if (args.qr) console.log(renderUnicodeCompact(url))
    }
  }
  console.log("\nThe pairing URL is a password. `--rotate-token` revokes every paired phone.")
}

await main()
