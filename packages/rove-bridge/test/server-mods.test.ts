/** Mod panes (`mods` push, `mod.press`, `mod.submit`) and plugin input dialogs (`prompt` push, `ui.promptReply`). */

import { afterEach, describe, expect, test } from "bun:test"
import { modsOps } from "../src/ops/mods.ts"
import { promptOps } from "../src/ops/prompts.ts"
import { PromptFeed } from "../src/prompts.ts"
import { AUTH, connect, start, stopServers } from "./server-harness.ts"

afterEach(stopServers)

describe("mods", () => {
  const PANE = { plugin: "p", id: "main", title: "T", tree: { type: "button" as const, key: "go", label: "Go" } }

  test("a client gets the open mod panes on connect and again when a mod redraws", async () => {
    let panes: unknown[] = [PANE]
    const listeners = new Set<(p: never) => void>()
    const h = start({
      mods: {
        current: () => panes as never,
        subscribe: (l) => {
          listeners.add(l)
          return () => listeners.delete(l)
        },
      },
    })
    const c = await connect(h.url, AUTH)
    await c.call("hello")
    panes = []
    for (const l of listeners) l(panes as never)
    await c.call("hello")
    expect(c.pushes.filter((p) => p.event === "mods").map((p) => p.data)).toEqual([{ panes: [PANE] }, { panes: [] }])
  })

  test("mod.press / mod.submit forward one control to the daemon and report what reached nothing", async () => {
    const rpcs: unknown[] = []
    let reply: { ok: boolean; reason?: string } = { ok: true }
    const h = start({
      areaOps: modsOps,
      api: {
        verb: async () => {
          throw new Error("no verbs")
        },
        rpc: async <T>(name: string, payload?: unknown) => {
          rpcs.push([name, payload])
          return reply as T
        },
      },
    })
    const c = await connect(h.url, AUTH)
    expect((await c.call("mod.press", { plugin: "p", pane: "main", key: "go" })).ok).toBe(true)
    expect(rpcs).toEqual([["mod.press", { plugin: "p", pane: "main", key: "go" }]])
    expect((await c.call("mod.press", { plugin: "p", pane: "main", key: "--flag x" })).error?.code).toBe("BAD_ARGS")
    reply = { ok: false, reason: "no-key" }
    expect((await c.call("mod.press", { plugin: "p", pane: "main", key: "gone" })).error?.code).toBe("MOD_UNAVAILABLE")
    reply = { ok: true }
    expect((await c.call("mod.submit", { plugin: "p", pane: "main", key: "note", value: "" })).ok).toBe(true)
    expect(rpcs.at(-1)).toEqual(["mod.submit", { plugin: "p", pane: "main", key: "note", value: "" }])
    expect((await c.call("mod.submit", { plugin: "p", pane: "main", key: "note" })).error?.code).toBe("BAD_ARGS")
  })
})

describe("plugin input dialog", () => {
  test("a new prompt reaches every client once, a replay does not, and an answer goes back by id", async () => {
    const prompts = new PromptFeed()
    const rpcs: unknown[] = []
    let reply = { ok: true }
    const h = start({
      prompts,
      areaOps: promptOps,
      api: {
        verb: async () => {
          throw new Error("no verbs")
        },
        rpc: async <T>(name: string, payload?: unknown) => {
          rpcs.push([name, payload])
          return reply as T
        },
      },
    })
    const c = await connect(h.url, AUTH)
    await c.call("hello")
    const prompt = { promptId: "p-1", title: "Repo to watch?", at: Date.now() }
    prompts.push(prompt)
    prompts.push(prompt)
    await c.call("hello")
    expect(c.pushes.filter((p) => p.event === "prompt").map((p) => p.data)).toEqual([prompt])

    expect((await c.call("ui.promptReply", { promptId: "p-1", value: "a/b" })).ok).toBe(true)
    expect(rpcs).toEqual([["ui.promptReply", { promptId: "p-1", value: "a/b" }]])
    reply = { ok: false }
    expect((await c.call("ui.promptReply", { promptId: "p-1" })).error?.code).toBe("PROMPT_GONE")
  })
})
