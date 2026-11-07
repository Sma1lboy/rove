import { describe, expect, test } from "bun:test"
import { BUNDLED_THEME_JSONS } from "@sma1lboy/rove/src/tui/context/theme/bundled.ts"
import { type HostedThemeDeps, createHostedThemeOps } from "../src/ops/theme-hosted.ts"
import type { Args, BridgeApi, OpTable } from "../src/ops/types.ts"

const api: BridgeApi = { verb: async () => ({}) as never, rpc: async () => ({}) as never }
const call = (table: OpTable, op: string, args: Args = {}) =>
  (table[op] as NonNullable<OpTable[string]>).run(args, { api })

function hosted(opts: { serve?: (url: string) => string; installed?: string[] } = {}) {
  const fetched: string[] = []
  const written: string[] = []
  const installed = [...(opts.installed ?? [])]
  const deps: HostedThemeDeps = {
    async fetchText(url) {
      fetched.push(url)
      if (!opts.serve) throw new Error("offline")
      return opts.serve(url)
    },
    installed: () => installed,
    write: (name) => {
      written.push(name)
      installed.push(name)
    },
  }
  return { ops: createHostedThemeOps(deps), fetched, written }
}

const claudeJson = JSON.stringify(BUNDLED_THEME_JSONS.claude)

describe("theme.install", () => {
  test("installs a catalogue theme fetched from rove.run, once", async () => {
    const h = hosted({ serve: () => claudeJson })
    expect(await call(h.ops, "theme.install", { name: "nord" })).toEqual({ name: "nord", installed: true })
    expect(h.fetched).toEqual(["https://rove.run/themes/nord.json"])
    expect(await call(h.ops, "theme.install", { name: "nord" })).toEqual({ name: "nord", installed: false })
    expect(h.written).toEqual(["nord"])
  })

  test("a name outside the catalogue is refused before anything is fetched", async () => {
    const h = hosted({ serve: () => claudeJson })
    for (const name of ["../../etc/x", "https://evil.example/t.json", "claude"]) {
      await expect(call(h.ops, "theme.install", { name })).rejects.toMatchObject({ code: "BAD_ARGS" })
    }
    expect(h.fetched).toEqual([])
  })

  test("a file that is not a theme is not written", async () => {
    const h = hosted({ serve: () => "<html>not found</html>" })
    await expect(call(h.ops, "theme.install", { name: "dracula" })).rejects.toMatchObject({ code: "UNAVAILABLE" })
    expect(h.written).toEqual([])
  })
})

describe("theme.hosted", () => {
  test("offline, every theme is listed as unavailable instead of failing the call", async () => {
    const reply = (await call(hosted().ops, "theme.hosted")) as { themes: unknown[]; unavailable: string[] }
    expect(reply.themes).toEqual([])
    expect(reply.unavailable).toContain("gruvbox")
  })

  test("each theme comes resolved for both modes, marked installed when it is", async () => {
    const reply = (await call(hosted({ serve: () => claudeJson, installed: ["nord"] }).ops, "theme.hosted")) as {
      themes: { name: string; installed: boolean; dark: Record<string, string> }[]
    }
    const nord = reply.themes.find((t) => t.name === "nord")
    expect(nord?.installed).toBe(true)
    expect(reply.themes.find((t) => t.name === "gruvbox")?.installed).toBe(false)
    expect(nord?.dark.background).toMatch(/^#[0-9a-f]{6}$/)
  })
})
