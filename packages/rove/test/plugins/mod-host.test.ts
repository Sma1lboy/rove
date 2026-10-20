/**
 * A mod end to end through the real PluginHost: a node process speaking the
 * JSON-lines wire, its trees validated onto `mod.ui`, and a client press
 * round-tripping back into it.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ModPaneView } from "@sma1lboy/rove-daemon/plugins/mod-tree"
import { savePluginRegistry } from "@sma1lboy/rove-daemon/plugins/registry"
import { PluginHost } from "@sma1lboy/rove-daemon/plugins/runtime"
import { afterEach, describe, expect, it } from "vitest"

const dirs: string[] = []
const hosts: PluginHost[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function waitFor(predicate: () => boolean, ms = 10_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 25))
  }
}

// Counts presses of `inc`; `bad` sends a tree no host can draw; `quit` exits.
// `Last:` shows the newest submitted note or `task.opened` event.
const COUNTER_MOD = `
let count = 0
let last = "-"
const send = (tree) => process.stdout.write(JSON.stringify({ type: "pane", id: "main", title: "Counter", tree }) + "\\n")
const draw = () => send({ type: "box", direction: "row", children: [
  { type: "button", key: "inc", label: "Add one" },
  { type: "button", key: "bad", label: "Break" },
  { type: "button", key: "quit", label: "Quit" },
  { type: "input", key: "note", placeholder: "note" },
  { type: "text", text: "Count: " + count },
  { type: "text", text: "Last: " + last },
] })
let buf = ""
process.stdin.on("data", (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf("\\n")) >= 0) {
    const msg = JSON.parse(buf.slice(0, nl))
    buf = buf.slice(nl + 1)
    if (msg.key === "inc") { count++; draw() }
    if (msg.key === "bad") send({ type: "marquee", text: "no" })
    if (msg.key === "quit") process.exit(3)
    if (msg.type === "submit") { last = msg.value; draw() }
    if (msg.type === "event") { last = msg.event.event + " " + msg.event.taskId; draw() }
  }
})
process.stdout.write(JSON.stringify({ type: "subscribe", events: ["task.opened"] }) + "\\n")
draw()
`

function startHost(): { host: PluginHost; latest: () => readonly ModPaneView[]; home: string } {
  const home = mkdtempSync(join(tmpdir(), "rove-mod-home-"))
  const root = mkdtempSync(join(tmpdir(), "rove-mod-root-"))
  dirs.push(home, root)
  writeFileSync(join(root, "mod.cjs"), COUNTER_MOD)
  writeFileSync(
    join(root, "rove-plugin.toml"),
    `id = "t.counter"\nname = "Counter"\nversion = "0.1.0"\nmin_rove_version = "0.1.0"\n\n[mod]\ncommand = ["node", "mod.cjs"]\n`,
  )
  mkdirSync(join(home, ".rove"), { recursive: true })
  savePluginRegistry(
    {
      plugins: [{ id: "t.counter", source: { kind: "link" }, root, enabled: true, version: "0.1.0", installedAt: 1 }],
    },
    home,
  )
  let panes: readonly ModPaneView[] = []
  const host = new PluginHost({
    homeDir: home,
    socketPath: join(home, "nope.sock"),
    binPath: "rove",
    publishMods: (next) => {
      panes = next
    },
  })
  hosts.push(host)
  host.start()
  return { host, latest: () => panes, home }
}

function textStartingWith(panes: readonly ModPaneView[], prefix: string): string | undefined {
  const tree = panes[0]?.tree
  if (tree?.type !== "box") return undefined
  for (const c of tree.children) if (c.type === "text" && c.text.startsWith(prefix)) return c.text
  return undefined
}

const countText = (panes: readonly ModPaneView[]) => textStartingWith(panes, "Count:")
const lastText = (panes: readonly ModPaneView[]) => textStartingWith(panes, "Last:")

describe("mods", () => {
  it("publishes a mod's tree and redraws it after a client press", async () => {
    const { host, latest } = startHost()
    await waitFor(() => countText(latest()) === "Count: 0")
    expect(latest()[0]).toMatchObject({ plugin: "t.counter", id: "main", title: "Counter" })

    expect(host.pressMod("t.counter", "main", "inc")).toBe("sent")
    await waitFor(() => countText(latest()) === "Count: 1")
  })

  it("keeps the last good tree when the mod sends one no host can draw", async () => {
    const { host, latest } = startHost()
    await waitFor(() => countText(latest()) === "Count: 0")
    host.pressMod("t.counter", "main", "bad")
    host.pressMod("t.counter", "main", "inc")
    // `inc` was written after `bad`, so once it shows, the bad tree was seen and refused.
    await waitFor(() => countText(latest()) === "Count: 1")
  })

  it("refuses a press on a button the current tree does not hold", async () => {
    const { host, latest } = startHost()
    await waitFor(() => latest().length === 1)
    expect(host.pressMod("t.counter", "main", "gone")).toBe("no-key")
    expect(host.pressMod("t.counter", "other", "inc")).toBe("no-pane")
    expect(host.pressMod("t.nobody", "main", "inc")).toBe("no-mod")
  })

  it("clears a crashed mod's panes, then restarts it", async () => {
    const { host, latest } = startHost()
    await waitFor(() => countText(latest()) === "Count: 0")
    host.pressMod("t.counter", "main", "inc")
    await waitFor(() => countText(latest()) === "Count: 1")
    host.pressMod("t.counter", "main", "quit")
    await waitFor(() => latest().length === 0)
    // A fresh process: its own state starts over.
    await waitFor(() => countText(latest()) === "Count: 0")
  })

  it("hands submitted input text to the mod, and refuses text for a key that is not an input", async () => {
    const { host, latest } = startHost()
    await waitFor(() => lastText(latest()) === "Last: -")
    expect(host.submitMod("t.counter", "main", "inc", "x")).toBe("no-key")
    expect(host.submitMod("t.counter", "main", "note", "buy milk")).toBe("sent")
    await waitFor(() => lastText(latest()) === "Last: buy milk")
  })

  it("delivers the plugin events the mod subscribed to", async () => {
    const { host, latest } = startHost()
    await waitFor(() => lastText(latest()) === "Last: -")
    host.handleUiReport({ kind: "task.opened", taskId: "T1" })
    await waitFor(() => lastText(latest()) === "Last: task.opened T1")
    // Not subscribed: a press round-trips after it, so if it had been sent it would show by then.
    host.handleUiReport({ kind: "file.opened", taskId: "T0" })
    host.pressMod("t.counter", "main", "inc")
    await waitFor(() => countText(latest()) === "Count: 1")
    expect(lastText(latest())).toBe("Last: task.opened T1")
  })
})
