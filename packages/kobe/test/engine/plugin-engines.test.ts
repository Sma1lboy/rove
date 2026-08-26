import { afterEach, describe, expect, it } from "vitest"
import { parsePluginManifest } from "../../../kobe-daemon/src/plugins/manifest.ts"
import {
  clearPluginEngines,
  isContribEngine,
  pluginEngineIds,
  registerPluginEngine,
} from "../../src/engine/contrib-engines.ts"
import { engineEntry } from "../../src/engine/registry.ts"

const MANIFEST = `
id = "acme-engines"
name = "Acme Engines"
version = "1.0.0"
min_rove_version = "0.8.0"

[[engines]]
id = "aider"
name = "Aider"
command = ["aider", "--no-auto-commits"]

[[engines.rules]]
state = "blocked"
all = ["(y)es/(n)o"]

[[engines.rules]]
state = "working"
any = ["ctrl-c to interrupt"]
`

describe("plugin manifest [[engines]]", () => {
  it("parses id/name/command and screen rules", () => {
    const { manifest } = parsePluginManifest(MANIFEST)
    expect(manifest.engines).toHaveLength(1)
    const e = manifest.engines[0]
    expect(e?.id).toBe("aider")
    expect(e?.command).toEqual(["aider", "--no-auto-commits"])
    expect(e?.rules[0]).toEqual({ state: "blocked", all: ["(y)es/(n)o"] })
  })

  it("rejects an engine that shadows a built-in", () => {
    const bad = MANIFEST.replace('id = "aider"', 'id = "claude"')
    expect(() => parsePluginManifest(bad)).toThrow(/shadows a built-in/)
  })

  it("rejects a rule with no conditions", () => {
    const bad = `${MANIFEST.split("[[engines.rules]]")[0]}[[engines.rules]]\nstate = "working"\n`
    expect(() => parsePluginManifest(bad)).toThrow(/needs at least one of/)
  })

  it("rejects invalid line_regex", () => {
    const bad = `${MANIFEST}\n[[engines.rules]]\nstate = "working"\nline_regex = ["("]\n`
    expect(() => parsePluginManifest(bad)).toThrow(/not a valid regex/)
  })

  it("parses [engines.identity] with snake_case keys", () => {
    const withIdentity = MANIFEST.replace(
      'command = ["aider", "--no-auto-commits"]',
      `command = ["aider", "--no-auto-commits"]

[engines.identity]
product_name = "Aider"
short_name = "Aider"
input_placeholder = "Ask Aider…"`,
    )
    const { manifest } = parsePluginManifest(withIdentity)
    expect(manifest.engines[0]?.identity).toEqual({
      productName: "Aider",
      shortName: "Aider",
      inputPlaceholder: "Ask Aider…",
    })
  })

  it("a manifest without engines parses to an empty list", () => {
    const { manifest } = parsePluginManifest('id = "x"\nname = "X"\nversion = "1"\nmin_rove_version = "0.8.0"\n')
    expect(manifest.engines).toEqual([])
  })
})

describe("plugin engine registration", () => {
  afterEach(() => clearPluginEngines())

  it("registers into the contrib table and resolves through engineEntry", () => {
    expect(isContribEngine("aider")).toBe(false)
    const ok = registerPluginEngine("aider", {
      displayName: "Aider",
      defaultCommand: ["aider"],
      screenManifest: { rules: [{ state: "working", any: ["ctrl-c to interrupt"] }] },
      identity: {
        vendorId: "aider",
        productName: "Aider",
        shortName: "Aider",
        assistantName: "Aider",
        inputPlaceholder: "Ask Aider…",
      },
    })
    expect(ok).toBe(true)
    expect(pluginEngineIds()).toEqual(["aider"])
    const entry = engineEntry("aider")
    expect(entry.displayName).toBe("Aider")
    expect(entry.defaultCommand).toEqual(["aider"])
    expect(entry.screenManifest).toBeDefined()
    expect(entry.builtin).toBe(false)
    // Identity rides the overlay — TUI copy comes from here, never hard-coded.
    expect(entry.identity?.inputPlaceholder).toBe("Ask Aider…")
  })

  it("a shipped catalog id cannot be overridden by a plugin", () => {
    const ok = registerPluginEngine("gemini", {
      displayName: "Evil Gemini",
      defaultCommand: ["evil"],
      screenManifest: { rules: [] },
    })
    expect(ok).toBe(false)
    expect(engineEntry("gemini").displayName).toBe("Gemini CLI")
  })

  it("clearPluginEngines drops registrations (entry falls back to custom)", () => {
    registerPluginEngine("aider", { displayName: "Aider", defaultCommand: ["aider"], screenManifest: { rules: [] } })
    clearPluginEngines()
    expect(engineEntry("aider").displayName).toBe("aider")
  })
})
