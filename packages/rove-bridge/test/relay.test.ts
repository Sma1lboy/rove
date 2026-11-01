import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RelayAgent } from "@hsinsekai-nanami/agent"
import { RelayTunnelClient } from "@hsinsekai-nanami/client"
import { startRelay } from "./relay-fixture.ts"
import { TOKEN, start, stopServers, upgradeStatus } from "./server-harness.ts"

const CODE = "c".repeat(43)
const cleanup: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
  stopServers()
})

/** Relay + ingress (the listener `--preset relay` adds) + the bridge's agent, connected. */
async function relayed() {
  const relay = startRelay()
  const root = mkdtempSync(join(tmpdir(), "rove-relay-web-"))
  writeFileSync(join(root, "index.html"), "<!doctype html><title>rove client</title>")
  const ingress = start({ tokenInQuery: true, web: { root } })
  const port = Number(new URL(ingress.url).port)
  const connected = Promise.withResolvers<void>()
  const agent = new RelayAgent({
    serverUrl: relay.url,
    code: CODE,
    localPort: port,
    quiet: true,
    onStateChange: (s) => s.state === "connected" && connected.resolve(),
  })
  agent.start()
  cleanup.push(() => agent.stop(), relay.stop)
  await connected.promise
  return relay
}

function tunnel(server: string, code = CODE): RelayTunnelClient {
  const client = new RelayTunnelClient({ serverUrl: server, code, quiet: true })
  cleanup.push(() => client.close())
  return client
}

/** One `{id, op}` request over a tunneled socket. */
function call(sock: Awaited<ReturnType<RelayTunnelClient["openSocket"]>>, op: string) {
  const reply = Promise.withResolvers<{ ok: boolean; result?: { protocol?: number } }>()
  sock.onmessage = (data) => {
    const frame = JSON.parse(String(data))
    if (frame.id === 1) reply.resolve(frame)
  }
  sock.send(JSON.stringify({ id: 1, op, args: {} }))
  return reply.promise
}

describe("--preset relay", () => {
  test("a browser reaches the bridge through the E2E tunnel: the page and an authenticated socket", async () => {
    const relay = await relayed()
    const client = tunnel(relay.url)
    await client.connect()
    expect((await client.fetch("/")).text()).toContain("rove client")
    const sock = await client.openSocket(`/ws?token=${TOKEN}`)
    const hello = await call(sock, "hello")
    expect(hello.ok).toBe(true)
    expect(typeof hello.result?.protocol).toBe("number")
  })

  test("the tunnel does not replace the bridge token: the ingress refuses a missing or wrong one", async () => {
    const ingress = start({ tokenInQuery: true })
    expect(await upgradeStatus(`${ingress.url}ws`)).toBe(401)
    expect(await upgradeStatus(`${ingress.url}ws?token=${"x".repeat(43)}`)).toBe(401)
  })

  test("a wrong pairing code never reaches this bridge", async () => {
    const relay = await relayed()
    await expect(tunnel(relay.url, "d".repeat(43)).connect()).rejects.toThrow()
  })

  test("only the relay ingress reads ?token=; the main listener still refuses it", async () => {
    const main = start()
    expect(await upgradeStatus(`${main.url}ws?token=${TOKEN}`)).toBe(401)
  })
})
