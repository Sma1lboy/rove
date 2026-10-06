import { describe, expect, test } from "bun:test"
import type { EngineStatus } from "@sma1lboy/rove/src/engine/engine-status.ts"
import type { PluginRowView } from "@sma1lboy/rove/src/tui-react/component/settings-dialog/plugins-core.ts"
import { insightOps } from "../src/ops/insight.ts"
import { type EngineDeps, createEngineOps } from "../src/ops/settings-engines.ts"
import { type SettingsDeps, createSettingsOps } from "../src/ops/settings.ts"
import type { Args, BridgeApi, OpTable } from "../src/ops/types.ts"
import { UsageStore } from "../src/usage-store.ts"

type Call = { kind: "verb" | "rpc"; name: string; payload: unknown }

function fakeApi(replies: Record<string, unknown> = {}): { api: BridgeApi; calls: Call[] } {
  const calls: Call[] = []
  const api: BridgeApi = {
    async verb(name, argv) {
      calls.push({ kind: "verb", name, payload: argv })
      return (replies[name] ?? {}) as never
    },
    async rpc(name, payload) {
      calls.push({ kind: "rpc", name, payload })
      return (replies[name] ?? {}) as never
    },
  }
  return { api, calls }
}

async function run<T = unknown>(table: OpTable, op: string, args: Args, replies: Record<string, unknown> = {}) {
  const spec = table[op]
  if (!spec) throw new Error(`no op ${op}`)
  const { api, calls } = fakeApi(replies)
  // `T` is the plain-JSON shape the test asserts on.
  const result = (await spec.run(args, { api })) as T
  return { result, calls }
}

function settingsDeps(over: Partial<SettingsDeps> = {}): { deps: SettingsDeps; toggled: [string, boolean][] } {
  const toggled: [string, boolean][] = []
  const deps: SettingsDeps = {
    usage: new UsageStore(),
    bridgeVersion: "0.9.240",
    engineName: (id) => id.toUpperCase(),
    listPlugins: () => [],
    pluginIds: () => ["notes"],
    setPluginEnabled: (id, enabled) => toggled.push([id, enabled]),
    ...over,
  }
  return { deps, toggled }
}

describe("usage.get", () => {
  test("no snapshot yet is null, not zero meters; a snapshot survives JSON with names and windows", async () => {
    const { deps } = settingsDeps()
    const ops = createSettingsOps(deps)
    expect((await run(ops, "usage.get", {})).result).toEqual({ usage: null })
    deps.usage.set(
      new Map([
        ["codex", { capturedAt: 5, windows: [{ kind: "session", label: "5h", percent: 80, resetsAt: null }] }],
        ["claude", { capturedAt: 9, windows: [{ kind: "week", label: "7d", percent: 96, resetsAt: 1_000 }] }],
      ]),
    )
    const wire = JSON.parse(JSON.stringify((await run(ops, "usage.get", {})).result))
    expect(wire).toEqual({
      usage: [
        {
          vendor: "claude",
          name: "CLAUDE",
          capturedAt: 9,
          windows: [{ kind: "week", label: "7d", percent: 96, resetsAt: 1_000 }],
        },
        {
          vendor: "codex",
          name: "CODEX",
          capturedAt: 5,
          windows: [{ kind: "session", label: "5h", percent: 80, resetsAt: null }],
        },
      ],
    })
  })

  test("an empty snapshot (daemon answered, no engine reports quota) is an empty list", async () => {
    const { deps } = settingsDeps()
    deps.usage.set(new Map())
    expect((await run(createSettingsOps(deps), "usage.get", {})).result).toEqual({ usage: [] })
  })
})

describe("daemon.info", () => {
  test("a daemon on another build than the bridge is stale; the same build is not", async () => {
    const ops = createSettingsOps(settingsDeps().deps)
    const old = await run<{ stale: boolean; daemonVersion: string }>(
      ops,
      "daemon.info",
      {},
      {
        "daemon.status": { roveVersion: "0.9.100", uptimeMs: 5, taskCount: 3 },
      },
    )
    expect(old.result).toMatchObject({ stale: true, daemonVersion: "0.9.100", bridgeVersion: "0.9.240", taskCount: 3 })
    const same = await run<{ stale: boolean }>(ops, "daemon.info", {}, { "daemon.status": { roveVersion: "0.9.240" } })
    expect(same.result.stale).toBe(false)
    expect(same.calls).toEqual([{ kind: "rpc", name: "daemon.status", payload: {} }])
  })

  test("a daemon that reports no version is unknown, never stale", async () => {
    const ops = createSettingsOps(settingsDeps().deps)
    const { result } = await run<{ stale: boolean; daemonVersion: string | null }>(
      ops,
      "daemon.info",
      {},
      { "daemon.status": {} },
    )
    expect(result).toMatchObject({ stale: false, daemonVersion: null })
  })
})

describe("plugins and feedback", () => {
  test("only an installed plugin id can be switched, and the switch is destructive", async () => {
    const { deps, toggled } = settingsDeps()
    const ops = createSettingsOps(deps)
    expect(ops["plugin.setEnabled"]?.destructive).toBe(true)
    await run(ops, "plugin.setEnabled", { id: "notes", enabled: false })
    expect(toggled).toEqual([["notes", false]])
    await expect(run(ops, "plugin.setEnabled", { id: "ghost", enabled: true })).rejects.toThrow(
      "not an installed plugin",
    )
    await expect(run(ops, "plugin.setEnabled", { id: "../notes", enabled: true })).rejects.toThrow(
      "not an installed plugin",
    )
    await expect(run(ops, "plugin.setEnabled", { id: "notes", enabled: "on" })).rejects.toThrow("boolean")
    expect(toggled).toHaveLength(1)
  })

  test("the plugin list drops install paths and manifest settings", async () => {
    const row: PluginRowView = {
      id: "notes",
      version: "1.0.0",
      enabled: true,
      linked: true,
      source: "/Users/me/secret/path",
      declares: { actions: 1, events: 0, panes: 0, engines: 0 },
      platformOk: true,
      hooksDeclared: true,
      lastRun: { at: 1, label: "startup", exitCode: 0, ok: true, running: false },
      settings: [],
      updateAvailable: false,
    }
    const ops = createSettingsOps(settingsDeps({ listPlugins: () => [row] }).deps)
    const wire = JSON.stringify((await run(ops, "plugins.list", {})).result)
    expect(wire).toContain('"id":"notes"')
    expect(wire).not.toContain("secret")
  })

  test("feedback posts one discussion through the verb; category must be a slug", async () => {
    const ops = createSettingsOps(settingsDeps().deps)
    expect(ops["feedback.send"]?.destructive).toBe(true)
    const { calls } = await run(ops, "feedback.send", { title: " slow board ", body: "it lags", category: "ideas" })
    expect(calls).toEqual([
      { kind: "verb", name: "feedback", payload: ["--title=slow board", "--body=it lags", "--category=ideas"] },
    ])
    await expect(run(ops, "feedback.send", { title: "t", body: "b", category: "../x" })).rejects.toThrow("category")
    await expect(run(ops, "feedback.send", { title: "", body: "b" })).rejects.toThrow("title")
  })
})

/** In-memory state.json + a fixed engine roster. */
function engineHarness(initial: Record<string, unknown> = {}, installed: string[] = ["gemini"]) {
  const state: Record<string, unknown> = { ...initial }
  const deps: EngineDeps = {
    load: () => ({ ...state }),
    patch: (patch) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete state[key]
        else state[key] = value
      }
    },
    installed: async () => installed,
    statuses: async (ids) =>
      ids.map(
        (vendor): EngineStatus => ({
          vendor,
          binary:
            vendor === "bob" ? { found: false, error: "not found on PATH" } : { found: true, path: `/bin/${vendor}` },
          account: vendor === "claude" ? { kind: "oauth", email: "me@example.com", organization: "acme" } : null,
        }),
      ),
    integrations: () => [],
    engineName: (id) => id,
    defaultCommand: (id) => [id, "--sandbox=none"],
  }
  return { state, ops: createEngineOps(deps) }
}

const ALL = ["claude", "codex", "copilot", "kimi", "pi", "omp", "bob"]

describe("engines.settings", () => {
  test("lists built-ins, custom and detected engines; no email, no command arguments", async () => {
    const { ops } = engineHarness({
      customEngineIds: ["mine"],
      "engineCommand.mine": "/opt/mine --api-key=SECRET",
      "engineProtocol.mine": "claude",
    })
    const { result } = await run<{ defaultId: string; engines: { id: string; binary: string; login: string }[] }>(
      ops,
      "engines.settings",
      {},
    )
    expect(result.engines.map((e) => e.id)).toEqual([...ALL, "mine", "gemini"])
    expect(result.defaultId).toBe("claude")
    const wire = JSON.stringify(result)
    expect(wire).not.toContain("SECRET")
    expect(wire).not.toContain("me@example.com")
    expect(result.engines.find((e) => e.id === "mine")).toMatchObject({
      binary: "/opt/mine",
      custom: true,
      protocol: "claude",
    })
    // Logged in is readable for claude; engines with no detector are unknown, not signed out.
    expect(result.engines.find((e) => e.id === "claude")?.login).toBe("yes")
    expect(result.engines.find((e) => e.id === "codex")?.login).toBe("unknown")
  })
})

describe("engine switches keep the section's invariants", () => {
  test("switching the default off hands it to the next enabled engine", async () => {
    const { ops, state } = engineHarness({ defaultVendor: "claude" })
    await run(ops, "engine.setEnabled", { id: "claude", enabled: false })
    expect(state.disabledEngineIds).toEqual(["claude"])
    expect(state.defaultVendor).toBe("codex")
  })

  test("the last enabled engine stays on", async () => {
    const off = ALL.filter((id) => id !== "bob")
    const { ops, state } = engineHarness({ disabledEngineIds: [...off, "gemini"], defaultVendor: "bob" })
    await expect(run(ops, "engine.setEnabled", { id: "bob", enabled: false })).rejects.toThrow("last enabled engine")
    expect(state.disabledEngineIds).toEqual([...off, "gemini"])
  })

  test("a detected engine can go off while another default stays, but never the only one that can be default", async () => {
    const { ops, state } = engineHarness({ defaultVendor: "claude" })
    await run(ops, "engine.setEnabled", { id: "gemini", enabled: false })
    expect(state.disabledEngineIds).toEqual(["gemini"])
    const lone = engineHarness({ disabledEngineIds: ALL.filter((id) => id !== "pi"), defaultVendor: "pi" })
    // gemini is still on, but it cannot take over as the default, so pi must stay.
    await expect(run(lone.ops, "engine.setEnabled", { id: "pi", enabled: false })).rejects.toThrow("default")
  })

  test("choosing a switched-off engine as default switches it back on", async () => {
    const { ops, state } = engineHarness({ disabledEngineIds: ["codex", "kimi"] })
    await run(ops, "engine.setDefault", { id: "codex" })
    expect(state.defaultVendor).toBe("codex")
    expect(state.disabledEngineIds).toEqual(["kimi"])
  })

  test("a detected-only engine cannot be the default, an unlisted id is refused", async () => {
    const { ops, state } = engineHarness()
    await expect(run(ops, "engine.setDefault", { id: "gemini" })).rejects.toThrow("cannot be the default")
    await expect(run(ops, "engine.setEnabled", { id: "evil; rm", enabled: false })).rejects.toThrow(
      "not a listed engine",
    )
    expect(state).toEqual({})
  })

  test("rename trims, blank clears, control characters and long names are refused", async () => {
    const { ops, state } = engineHarness()
    await run(ops, "engine.rename", { id: "codex", name: "  Fast one " })
    expect(state["engineName.codex"]).toBe("Fast one")
    await run(ops, "engine.rename", { id: "codex", name: "   " })
    expect("engineName.codex" in state).toBe(false)
    await expect(run(ops, "engine.rename", { id: "codex", name: "a\nb" })).rejects.toThrow("printable")
    await expect(run(ops, "engine.rename", { id: "codex", name: "x".repeat(61) })).rejects.toThrow("printable")
  })

  test("reset on a built-in drops its overrides only; on a custom engine it removes it everywhere", async () => {
    const { ops, state } = engineHarness({
      customEngineIds: ["mine"],
      disabledEngineIds: ["mine", "kimi"],
      defaultVendor: "mine",
      "engineCommand.codex": "/opt/codex",
      "engineName.codex": "Fast",
      "engineCommand.mine": "/opt/mine",
      "engineName.mine": "Mine",
      "engineProtocol.mine": "claude",
    })
    expect((await run(ops, "engine.reset", { id: "codex" })).result).toEqual({ id: "codex", removed: false })
    expect(state["engineCommand.codex"]).toBeUndefined()
    expect(state.customEngineIds).toEqual(["mine"])
    expect((await run(ops, "engine.reset", { id: "mine" })).result).toEqual({ id: "mine", removed: true })
    for (const key of ["engineCommand.mine", "engineName.mine", "engineProtocol.mine"]) expect(key in state).toBe(false)
    expect(state.customEngineIds).toEqual([])
    expect(state.disabledEngineIds).toEqual(["kimi"])
  })

  test("removing the default custom engine hands the default on; removing the only enabled engine is refused", async () => {
    const handoff = engineHarness({ customEngineIds: ["mine"], defaultVendor: "mine" })
    await run(handoff.ops, "engine.reset", { id: "mine" })
    expect(handoff.state.defaultVendor).toBe("claude")
    const only = engineHarness({
      customEngineIds: ["mine"],
      disabledEngineIds: [...ALL, "gemini"],
      defaultVendor: "mine",
    })
    await expect(run(only.ops, "engine.reset", { id: "mine" })).rejects.toThrow("last enabled engine")
    expect(only.state.customEngineIds).toEqual(["mine"])
  })

  test("every engine write is destructive and there is no way to author a launch command", () => {
    const { ops } = engineHarness()
    for (const [name, spec] of Object.entries(ops)) expect(spec.destructive).toBe(name !== "engines.settings")
    expect(Object.keys(ops).some((name) => /command/i.test(name))).toBe(false)
  })
})

describe("insight ops", () => {
  test("read-output builds one verb call; a tab, cursor and limit pass validation", async () => {
    const { calls } = await run(insightOps, "output.read", {
      taskId: "T1",
      tab: "tab-2",
      source: "terminal",
      cursor: "abc.DEF-1_2",
      limit: 20,
    })
    expect(calls).toEqual([
      {
        kind: "verb",
        name: "read-output",
        payload: ["--task-id=T1", "--tab=tab-2", "--source=terminal", "--cursor=abc.DEF-1_2", "--limit=20"],
      },
    ])
  })

  test("read-output refuses a flag-like task, a foreign cursor, a bad source and an over-large page", async () => {
    await expect(run(insightOps, "output.read", { taskId: "--task-id=x" })).rejects.toThrow("not a task id")
    await expect(run(insightOps, "output.read", { taskId: "T1", cursor: "a b;c" })).rejects.toThrow("cursor")
    await expect(run(insightOps, "output.read", { taskId: "T1", source: "shell" })).rejects.toThrow(
      "auto|history|terminal",
    )
    await expect(run(insightOps, "output.read", { taskId: "T1", limit: 51 })).rejects.toThrow("1..50")
    await expect(run(insightOps, "output.read", { taskId: "T1", tab: "tab-1; x" })).rejects.toThrow("not a tab id")
  })

  test("digest and agent-turns take their filters as --name=value", async () => {
    const digest = await run(insightOps, "repo.digest", { repo: "/r", sinceDays: 14 })
    expect(digest.calls[0]).toEqual({ kind: "verb", name: "digest", payload: ["--repo=/r", "--since-days=14"] })
    const turns = await run(insightOps, "turns.list", { repo: "/r", limit: 50 })
    expect(turns.calls[0]).toEqual({ kind: "verb", name: "agent-turns", payload: ["--repo=/r", "--limit=50"] })
    const all = await run(insightOps, "turns.list", {})
    expect(all.calls[0]?.payload).toEqual([])
    await expect(run(insightOps, "repo.digest", { repo: "r" })).rejects.toThrow("absolute path")
    await expect(run(insightOps, "turns.list", { taskId: "--x" })).rejects.toThrow("not a task id")
  })
})
