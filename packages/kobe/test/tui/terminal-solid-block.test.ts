import { Terminal } from "@xterm/headless"
import { describe, expect, it } from "vitest"
import { xtermLineToChunks } from "../../src/tui/panes/terminal/xterm-chunks"
import type { TerminalStyleRewrite } from "../../src/types/terminal-presentation"

async function rowFor(
  bytes: string,
  styleRewrites?: readonly TerminalStyleRewrite[],
): Promise<ReturnType<typeof xtermLineToChunks>> {
  const t = new Terminal({ cols: 20, rows: 4, allowProposedApi: true })
  await new Promise<void>((r) => t.write(bytes, () => r()))
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  return xtermLineToChunks(t.buffer.active.getLine(0) as any, -1, styleRewrites)
}

describe("embedded terminal default foreground", () => {
  it("leaves default text on an explicit app background inheritable", async () => {
    const row = await rowFor("\x1b[48;2;234;231;223mmessage")
    expect(row[0]?.fg).toBeUndefined()
    expect(row[0]?.bg).toEqual([234, 231, 223])
  })

  it("leaves fully default cells to inherit the outer Rove theme", async () => {
    const row = await rowFor("message")
    expect(row[0]?.fg).toBeUndefined()
    expect(row[0]?.bg).toBeUndefined()
  })
})

describe("engine-owned terminal style rewrites", () => {
  const transcriptRewrite = {
    matchBackground: [48, 48, 47],
    foreground: [20, 20, 19],
    background: [234, 231, 223],
  } as const

  it("rewrites the Codex user-message surface only when requested", async () => {
    const bytes = "\x1b[48;2;48;48;47mmessage"
    const primary = await rowFor(bytes)
    const transcript = await rowFor(bytes, [transcriptRewrite])

    expect(primary[0]?.fg).toBeUndefined()
    expect(primary[0]?.bg).toEqual([48, 48, 47])
    expect(transcript[0]).toMatchObject({ fg: [20, 20, 19], bg: [234, 231, 223] })
  })

  it("does not overwrite an explicit foreground on the same background", async () => {
    const row = await rowFor("\x1b[38;2;0;255;255m\x1b[48;2;48;48;47mmessage", [transcriptRewrite])
    expect(row[0]).toMatchObject({ fg: [0, 255, 255], bg: [48, 48, 47] })
  })
})

describe("solid-block minimum-contrast immunity (issue #1 zebra)", () => {
  it("fg==bg solid blocks become bg-only spaces", async () => {
    const row = await rowFor("\x1b[38;2;238;238;238m\x1b[48;2;238;238;238m▄▄▄\x1b[0m")
    expect(row).toHaveLength(1)
    expect(row[0]?.text).toBe("   ")
    expect(row[0]?.bg).toEqual([238, 238, 238])
  })

  it("fg!=bg half-blocks keep their glyph (real two-pixel cells)", async () => {
    const row = await rowFor("\x1b[38;2;255;0;0m\x1b[48;2;0;0;255m▀▀\x1b[0m")
    expect(row[0]?.text).toBe("▀▀")
    expect(row[0]?.fg).toEqual([255, 0, 0])
    expect(row[0]?.bg).toEqual([0, 0, 255])
  })

  it("non-block glyphs are untouched even when fg==bg", async () => {
    const row = await rowFor("\x1b[38;2;9;9;9m\x1b[48;2;9;9;9mXX\x1b[0m")
    expect(row[0]?.text).toBe("XX")
  })
})

describe("matcher stays in lockstep with the substitution", () => {
  it("a substituted row matches its own chunks (no perpetual re-render)", async () => {
    const t = new Terminal({ cols: 20, rows: 4, allowProposedApi: true })
    await new Promise<void>((r) => t.write("\x1b[38;2;9;9;9m\x1b[48;2;9;9;9m▄▄▄\x1b[0m ok", () => r()))
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    const line = t.buffer.active.getLine(0) as any
    const { xtermLineMatchesChunks } = await import("../../src/tui/panes/terminal/xterm-chunks")
    expect(xtermLineMatchesChunks(line, xtermLineToChunks(line))).toBe(true)
  })
})
