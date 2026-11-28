import { describe, expect, test } from "bun:test"
import type { DetectedTerminalTheme } from "@sma1lboy/rove-core/theme/terminal-detect.ts"
import { themeFromTerminalScheme } from "@sma1lboy/rove-core/theme/terminal-scheme.ts"
import { type TerminalThemeDeps, createTerminalThemeOps } from "../src/ops/theme-terminals.ts"
import type { Args, BridgeApi, OpTable } from "../src/ops/types.ts"

const api: BridgeApi = { verb: async () => ({}) as never, rpc: async () => ({}) as never }
const call = (table: OpTable, op: string, args: Args = {}) =>
  (table[op] as NonNullable<OpTable[string]>).run(args, { api })

function makeDetected(id: "ghostty" | "kitty", fontFamily?: string): DetectedTerminalTheme {
  const scheme = {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    ...(fontFamily ? { fontFamily } : {}),
    ansi: [
      "#45475a",
      "#f38ba8",
      "#a6e3a1",
      "#f9e2af",
      "#89b4fa",
      "#f5c2e7",
      "#94e2d5",
      "#bac2de",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ],
  }
  return {
    id,
    label: id === "ghostty" ? "Ghostty" : "Kitty",
    configPath: `/home/test/.config/${id}/config`,
    themeName: id,
    scheme,
    theme: themeFromTerminalScheme(scheme),
  }
}

function makeOps(opts: { detected?: DetectedTerminalTheme[]; installed?: string[] } = {}) {
  const detected = opts.detected ?? []
  const installed = [...(opts.installed ?? [])]
  const written: string[] = []
  const deps: TerminalThemeDeps = {
    detectAll: () => detected,
    detectOne: (id) => detected.find((d) => d.id === id) ?? null,
    installed: () => installed,
    write: (name) => {
      written.push(name)
      if (!installed.includes(name)) installed.push(name)
    },
  }
  return { ops: createTerminalThemeOps(deps), written }
}

describe("theme.terminals", () => {
  test("lists detected local terminals with resolved palettes, fontFamily, and installed flag", async () => {
    const { ops } = makeOps({
      detected: [makeDetected("ghostty", "Berkeley Mono"), makeDetected("kitty")],
      installed: ["ghostty"],
    })
    const reply = (await call(ops, "theme.terminals")) as {
      terminals: Array<{
        id: string
        label: string
        name: string
        fontFamily?: string
        installed: boolean
        dark: Record<string, string>
      }>
    }
    expect(reply.terminals).toHaveLength(2)
    expect(reply.terminals[0]).toMatchObject({
      id: "ghostty",
      label: "Ghostty",
      name: "ghostty",
      fontFamily: "Berkeley Mono",
      installed: true,
    })
    expect(reply.terminals[0]?.dark.background).toBe("#1e1e2e")
    expect(reply.terminals[0]?.dark.cursor).toBe("#f5e0dc")
    expect(reply.terminals[0]?.dark.terminalRed).toBe("#f38ba8")
    expect(reply.terminals[1]?.installed).toBe(false)
    expect(reply.terminals[1]?.fontFamily).toBeUndefined()
  })
})

describe("theme.importTerminal", () => {
  test("imports an allowlisted terminal id and writes its theme", async () => {
    const { ops, written } = makeOps({ detected: [makeDetected("ghostty", "JetBrains Mono")] })
    const reply = await call(ops, "theme.importTerminal", { terminal: "ghostty" })
    expect(reply).toEqual({
      name: "ghostty",
      terminal: "ghostty",
      installed: true,
      fontFamily: "JetBrains Mono",
    })
    expect(written).toEqual(["ghostty"])
  })

  test.each(["../../etc/passwd", "iterm2", "", 42])(
    "rejects unknown terminal id (%p) with BAD_ARGS",
    async (terminal) => {
      const { ops, written } = makeOps({ detected: [makeDetected("ghostty")] })
      await expect(call(ops, "theme.importTerminal", { terminal })).rejects.toMatchObject({ code: "BAD_ARGS" })
      expect(written).toEqual([])
    },
  )

  test("returns NOT_FOUND when the requested terminal has no readable config", async () => {
    const { ops } = makeOps({ detected: [] })
    await expect(call(ops, "theme.importTerminal", { terminal: "alacritty" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })
})
