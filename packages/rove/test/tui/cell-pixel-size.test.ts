/**
 * The `CSI 16 t` cell measurement — the one fact Rove had at no layer, and the
 * prerequisite for placing anything sized in pixels inside a grid sized in
 * cells.
 *
 * Two things are worth pinning, and neither needs a terminal. The PARSE has to
 * read `CSI 6 ; height ; width t` in that order (they are swapped relative to
 * how everything else in the codebase spells a size, and swapping them silently
 * produces a plausible wrong number rather than a failure), and has to read the
 * zeros a terminal answers when it has no pixel geometry as "no capability",
 * not as a cell of size zero. The QUERY has to hand stdin back exactly as it
 * found it: it runs at boot, microseconds before the renderer claims the same
 * stream, so a raw mode or a flow state left flipped eats the user's first
 * keystrokes with nothing on screen to explain it.
 */

import { describe, expect, it } from "vitest"
import { type CellQueryInput, parseCellPixelReply, queryCellPixelSize } from "../../src/tui/lib/cell-pixel-size.ts"

/** A scriptable stdin: records the mode/flow calls, replays `script` on resume. */
function fakeStdin(script: string | null, opts: { isRaw?: boolean; paused?: boolean } = {}) {
  const listeners: Array<(chunk: Buffer | string) => void> = []
  const calls: string[] = []
  let paused = opts.paused ?? true
  const stdin: CellQueryInput & { calls: string[] } = {
    isTTY: true,
    isRaw: opts.isRaw ?? false,
    calls,
    setRawMode(mode: boolean) {
      calls.push(`setRawMode(${mode})`)
      // Node's setRawMode resumes the stream; the real footgun this models.
      paused = false
    },
    resume() {
      calls.push("resume")
      paused = false
      if (script !== null) for (const l of [...listeners]) l(Buffer.from(script, "latin1"))
    },
    pause() {
      calls.push("pause")
      paused = true
    },
    isPaused: () => paused,
    on(_e, l) {
      listeners.push(l)
    },
    off(_e, l) {
      const i = listeners.indexOf(l)
      if (i >= 0) listeners.splice(i, 1)
    },
  }
  return { stdin, listeners }
}

function fakeStdout() {
  const written: string[] = []
  return { isTTY: true, written, write: (chunk: string) => written.push(chunk) }
}

describe("parseCellPixelReply", () => {
  it("reads HEIGHT then WIDTH, in the order the terminal sends them", () => {
    // Ghostty's measured answer at the probe's font size: 16px wide, 34 high.
    // Reading the two numbers the other way round yields 34×16, which is a
    // perfectly plausible cell and places every picture wrong.
    expect(parseCellPixelReply("\x1b[6;34;16t")).toEqual({ width: 16, height: 34 })
  })

  it("finds the reply amid unrelated bytes typed during the window", () => {
    expect(parseCellPixelReply("q\x1b[6;34;16tz")).toEqual({ width: 16, height: 34 })
  })

  it("reads a zeros answer as no capability, not as a zero-sized cell", () => {
    expect(parseCellPixelReply("\x1b[6;0;0t")).toBeNull()
    expect(parseCellPixelReply("\x1b[6;34;0t")).toBeNull()
  })

  it("is null for input that carries no reply at all", () => {
    expect(parseCellPixelReply("")).toBeNull()
    expect(parseCellPixelReply("\x1b[6;34;16")).toBeNull()
  })
})

describe("queryCellPixelSize", () => {
  it("writes CSI 16 t behind a DA1 fence and resolves the terminal's answer", async () => {
    const { stdin } = fakeStdin("\x1b[6;34;16t")
    const stdout = fakeStdout()
    expect(await queryCellPixelSize({ stdin, stdout })).toEqual({ width: 16, height: 34 })
    expect(stdout.written).toEqual(["\x1b[16t\x1b[c"])
  })

  it("settles on a bare DA1 reply — a terminal that ignored the size query has answered", async () => {
    // Without the fence this costs the full timeout on EVERY boot in a
    // terminal with no pixel geometry, which is most of them.
    const { stdin } = fakeStdin("\x1b[?62;22c")
    const started = Date.now()
    expect(await queryCellPixelSize({ stdin, stdout: fakeStdout(), timeoutMs: 5000 })).toBeNull()
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it("restores the raw mode and the paused state it found", async () => {
    // The renderer takes this same stdin a few lines later. Leaving it raw, or
    // leaving it flowing, silently swallows the first keys the user presses.
    const { stdin } = fakeStdin("\x1b[6;34;16t", { isRaw: false, paused: true })
    await queryCellPixelSize({ stdin, stdout: fakeStdout() })
    expect(stdin.calls).toEqual(["setRawMode(true)", "resume", "setRawMode(false)", "pause"])
  })

  it("leaves an already-raw, already-flowing stdin exactly as raw and flowing", async () => {
    const { stdin } = fakeStdin("\x1b[6;34;16t", { isRaw: true, paused: false })
    await queryCellPixelSize({ stdin, stdout: fakeStdout() })
    expect(stdin.calls).toEqual(["setRawMode(true)", "resume", "setRawMode(true)"])
  })

  it("assembles a reply split across chunks", async () => {
    const { stdin, listeners } = fakeStdin(null)
    const pending = queryCellPixelSize({ stdin, stdout: fakeStdout(), timeoutMs: 1000 })
    for (const part of ["\x1b[6;", "34;", "16t"]) for (const l of [...listeners]) l(Buffer.from(part, "latin1"))
    expect(await pending).toEqual({ width: 16, height: 34 })
  })

  it("gives up on a terminal that never answers", async () => {
    const { stdin } = fakeStdin(null)
    expect(await queryCellPixelSize({ stdin, stdout: fakeStdout(), timeoutMs: 5 })).toBeNull()
    expect(stdin.calls.at(-1)).toBe("pause")
  })

  it("settles immediately on a zeros answer instead of waiting out the timeout", async () => {
    // A terminal that answers `0` HAS answered. Waiting the full window for it
    // would put the timeout on every boot in such a terminal.
    const { stdin } = fakeStdin("\x1b[6;0;0t")
    const started = Date.now()
    expect(await queryCellPixelSize({ stdin, stdout: fakeStdout(), timeoutMs: 5000 })).toBeNull()
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it("never touches a non-tty stdin or a redirected stdout", async () => {
    const piped = fakeStdin("\x1b[6;34;16t")
    piped.stdin.isTTY = false
    expect(await queryCellPixelSize({ stdin: piped.stdin, stdout: fakeStdout() })).toBeNull()
    expect(piped.stdin.calls).toEqual([])

    const redirected = fakeStdin("\x1b[6;34;16t")
    const file = { ...fakeStdout(), isTTY: false }
    expect(await queryCellPixelSize({ stdin: redirected.stdin, stdout: file })).toBeNull()
    expect(file.written).toEqual([])
  })
})
