import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { savePluginRegistry } from "@sma1lboy/kobe-daemon/plugins/registry"
import { afterEach, describe, expect, it } from "vitest"
import { clearPluginEngines } from "../../src/engine/contrib-engines.ts"
import { loadPluginEngines } from "../../src/engine/plugin-engines.ts"
import { engineEntry } from "../../src/engine/registry.ts"

const dirs: string[] = []
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

const savedHome = process.env.ROVE_HOME_DIR
afterEach(() => {
  clearPluginEngines()
  // Assigning undefined would store the string "undefined" — a real delete.
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function homeWith(plugins: { id: string; root: string; enabled?: boolean }[]): string {
  const home = tmp("kobe-engines-home-")
  mkdirSync(join(home, ".rove"), { recursive: true })
  savePluginRegistry(
    {
      plugins: plugins.map((p) => ({
        id: p.id,
        source: { kind: "link" as const },
        root: p.root,
        enabled: p.enabled ?? true,
        version: "1.0.0",
        installedAt: 1,
      })),
    },
    home,
  )
  process.env.ROVE_HOME_DIR = home
  return home
}

function pluginRoot(manifest: string): string {
  const root = tmp("kobe-engines-plugin-")
  writeFileSync(join(root, "rove-plugin.toml"), manifest)
  return root
}

const MANIFEST = `
id = "acme.engines"
name = "Acme"
version = "1.0.0"
min_rove_version = "0.8.0"

[[engines]]
id = "aider"
name = "Aider"
command = ["aider"]

[engines.identity]
short_name = "Aid"
input_placeholder = "Ask Aider anything…"

[[engines.rules]]
state = "working"
any = ["ctrl-c to interrupt"]
`

describe("loadPluginEngines", () => {
  it("registers enabled plugins' engines, ignoring retired identity keys", () => {
    homeWith([{ id: "acme.engines", root: pluginRoot(MANIFEST) }])
    expect(loadPluginEngines()).toEqual(["aider"])
    const entry = engineEntry("aider")
    expect(entry.displayName).toBe("Aider")
    // The manifest sets `input_placeholder`, a key the loader does not know:
    // it must register without throwing, and the field is simply absent.
    expect(entry.identity).toEqual({ vendorId: "aider", shortName: "Aid" })
  })

  it("shortName falls back to the engine name when identity is absent", () => {
    const bare = MANIFEST.replace(/\[engines\.identity\][^\[]*/, "")
    homeWith([{ id: "acme.engines", root: pluginRoot(bare) }])
    expect(loadPluginEngines()).toEqual(["aider"])
    expect(engineEntry("aider").identity).toEqual({ vendorId: "aider", shortName: "Aider" })
  })

  it("skips disabled plugins and unreadable manifests without throwing", () => {
    const broken = tmp("kobe-engines-broken-") // no manifest file at all
    homeWith([
      { id: "off.plugin", root: pluginRoot(MANIFEST), enabled: false },
      { id: "broken.plugin", root: broken },
    ])
    expect(loadPluginEngines()).toEqual([])
  })

  it("an empty registry registers nothing", () => {
    homeWith([])
    expect(loadPluginEngines()).toEqual([])
  })

  // A subcommand- or directory-positional CLI dies on its own first prompt
  // under the "argv" default. The manifest key is the author's only fix, so it
  // has to survive all three hops: TOML parse -> ContribEngineSpec -> registry.
  it("carries first_message_delivery from the manifest to the registry entry", () => {
    const paste = MANIFEST.replace('command = ["aider"]', 'command = ["aider"]\nfirst_message_delivery = "paste"')
    homeWith([{ id: "acme.engines", root: pluginRoot(paste) }])
    expect(loadPluginEngines()).toEqual(["aider"])
    expect(engineEntry("aider").firstMessageDelivery).toBe("paste")
  })

  it("omitting first_message_delivery leaves the registry's argv default", () => {
    homeWith([{ id: "acme.engines", root: pluginRoot(MANIFEST) }])
    expect(loadPluginEngines()).toEqual(["aider"])
    expect(engineEntry("aider").firstMessageDelivery).toBeUndefined()
  })
})
