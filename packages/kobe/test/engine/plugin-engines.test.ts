import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RESERVED_ENGINE_IDS, parsePluginManifest } from "../../../kobe-daemon/src/plugins/manifest.ts"
import { savePluginRegistry } from "../../../kobe-daemon/src/plugins/registry.ts"
import {
  CONTRIB_ENGINES,
  CONTRIB_ENGINE_IDS,
  clearPluginEngines,
  isContribEngine,
  pluginEngineIds,
  registerPluginEngine,
} from "../../src/engine/contrib-engines.ts"
import { loadPluginEngines, reloadPluginEngines } from "../../src/engine/plugin-engines.ts"
import { engineEntry } from "../../src/engine/registry.ts"
import { BUILTIN_VENDORS } from "../../src/types/vendor.ts"

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

  it.each(CONTRIB_ENGINE_IDS)("rejects an engine shadowing the shipped `%s` catalog entry", (id) => {
    const bad = MANIFEST.replace('id = "aider"', `id = "${id}"`)
    expect(() => parsePluginManifest(bad)).toThrow(/shadows a built-in/)
  })

  it("keeps the daemon-side reserved list in lockstep with kobe's engine lists", () => {
    // The daemon cannot import kobe (dependency direction), so its manifest
    // parser carries its own copy — this pins the two halves together.
    expect([...RESERVED_ENGINE_IDS].sort()).toEqual([...BUILTIN_VENDORS, ...CONTRIB_ENGINE_IDS].sort())
  })

  it("rejects a rule with no conditions", () => {
    const bad = `${MANIFEST.split("[[engines.rules]]")[0]}[[engines.rules]]\nstate = "working"\n`
    expect(() => parsePluginManifest(bad)).toThrow(/needs at least one of/)
  })

  it("parses first_message_delivery", () => {
    const paste = MANIFEST.replace(
      'command = ["aider", "--no-auto-commits"]',
      'command = ["aider"]\nfirst_message_delivery = "paste"',
    )
    expect(parsePluginManifest(paste).manifest.engines[0]?.firstMessageDelivery).toBe("paste")
    expect(parsePluginManifest(MANIFEST).manifest.engines[0]?.firstMessageDelivery).toBeUndefined()
  })

  it("rejects an unknown first_message_delivery rather than falling back to argv", () => {
    // Silently defaulting would leave the author with the launch failure the
    // key exists to fix, and no error pointing at the typo.
    const bad = MANIFEST.replace('name = "Aider"', 'name = "Aider"\nfirst_message_delivery = "stdin"')
    expect(() => parsePluginManifest(bad)).toThrow(/first_message_delivery must be argv \| paste/)
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
    // Retired keys (product_name / input_placeholder) are ignored, not errors.
    const { manifest } = parsePluginManifest(withIdentity)
    expect(manifest.engines[0]?.identity).toEqual({ shortName: "Aider" })
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
      identity: { shortName: "Aider" },
    })
    expect(ok).toBe(true)
    expect(pluginEngineIds()).toEqual(["aider"])
    const entry = engineEntry("aider")
    expect(entry.displayName).toBe("Aider")
    expect(entry.defaultCommand).toEqual(["aider"])
    expect(entry.screenManifest).toBeDefined()
    expect(entry.builtin).toBe(false)
    // Identity rides the overlay — TUI copy comes from here, never hard-coded.
    expect(entry.identity).toEqual({ shortName: "Aider" })
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

describe("loadPluginEngines + reloadPluginEngines", () => {
  afterEach(() => clearPluginEngines())

  /** A throwaway home whose registry links one plugin at `root`. */
  function registryLinking(root: string, enabled = true): string {
    const home = mkdtempSync(join(tmpdir(), "rove-pe-home-"))
    savePluginRegistry(
      {
        plugins: [{ id: "acme-engines", source: { kind: "link" }, root, enabled, version: "1.0.0", installedAt: 0 }],
      },
      home,
    )
    return home
  }

  function pluginRoot(manifest: string): string {
    const root = mkdtempSync(join(tmpdir(), "rove-pe-plugin-"))
    writeFileSync(join(root, "rove-plugin.toml"), manifest)
    return root
  }

  it("loads engines from enabled plugins in the registry (homeDir seam)", () => {
    const home = registryLinking(pluginRoot(MANIFEST))
    expect(loadPluginEngines(home)).toEqual(["aider"])
    expect(pluginEngineIds()).toEqual(["aider"])
  })

  it("contributes nothing for a disabled plugin", () => {
    const home = registryLinking(pluginRoot(MANIFEST), false)
    expect(loadPluginEngines(home)).toEqual([])
    expect(pluginEngineIds()).toEqual([])
  })

  it("contributes nothing for a manifest whose engine id is rejected at parse time", () => {
    // `gemini` now fails manifest parsing (reserved id), so the loader's
    // best-effort catch skips the plugin — no engine, no crash.
    const home = registryLinking(pluginRoot(MANIFEST.replace('id = "aider"', 'id = "gemini"')))
    expect(loadPluginEngines(home)).toEqual([])
    expect(pluginEngineIds()).toEqual([])
  })

  it("warns and skips a catalog id that slips past the manifest check (drift guard)", () => {
    // Simulate the drift this guard exists for: kobe's shipped catalog gains
    // an engine the daemon-side reserved list doesn't know about. The manifest
    // parses, registration refuses — the user must hear about it, not lose it.
    CONTRIB_ENGINES.drifted = {
      displayName: "Drifted",
      defaultCommand: ["drifted"],
      screenManifest: { rules: [] },
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const home = registryLinking(pluginRoot(MANIFEST.replace('id = "aider"', 'id = "drifted"')))
      expect(loadPluginEngines(home)).toEqual([])
      expect(pluginEngineIds()).toEqual([])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("`drifted`"))
    } finally {
      warn.mockRestore()
      Reflect.deleteProperty(CONTRIB_ENGINES, "drifted")
    }
  })

  it("reloadPluginEngines drops an engine disabled since the last load", () => {
    const root = pluginRoot(MANIFEST)
    const home = registryLinking(root)
    expect(loadPluginEngines(home)).toEqual(["aider"])
    savePluginRegistry(
      {
        plugins: [
          { id: "acme-engines", source: { kind: "link" }, root, enabled: false, version: "1.0.0", installedAt: 0 },
        ],
      },
      home,
    )
    expect(reloadPluginEngines(home)).toEqual([])
    expect(pluginEngineIds()).toEqual([])
  })
})
