/**
 * Keep the operator's identity out of a committed recording.
 *
 * `HOME` stays the operator's during a take (the engine needs its login — see
 * `hero-env.ts`), so an e-mail address or a registered secret can reach the
 * screen. Two passes:
 *
 *  1. `redactCast` masks matches in the output stream with `*`, one per code
 *     unit, so every column after it stays where the TUI put it. Matching runs
 *     over the stream with escape sequences removed and chunk boundaries
 *     joined, because a styled or split address is still an address on screen.
 *  2. `assertCastClean` replays the result through a headless xterm and fails
 *     if any screen state still shows one — a TUI that paints a value in
 *     cursor-positioned fragments slips past pass 1, and must not slip past
 *     this. A failed take is re-shot on a route that never shows the value.
 */

import { Terminal } from "@xterm/headless"
import { type CastEvent, parseCast } from "../../src/lib/cast.ts"

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g

// CSI, OSC/DCS/APC strings, charset designations (`ESC ( B`), then any other
// two-byte escape — none of their bytes may be masked.
const ESCAPE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[\]P_^][^\x07\x1b]*(?:\x07|\x1b\\)?|[()*+#%][\s\S]|[\s\S])/g

function patterns(literals: readonly string[]): RegExp[] {
  const escaped = literals.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  return [EMAIL, ...escaped.map((l) => new RegExp(l, "g"))]
}

/** Output with matches masked; header, timing, resizes and markers untouched. */
export function redactCast(text: string, literals: readonly string[] = []): string {
  const [header, ...lines] = text.split("\n").filter((line) => line.length > 0)
  const events = lines.map((line) => JSON.parse(line) as [number, string, string])
  const outputs = events.filter((e) => e[1] === "o")
  const stream = outputs.map((e) => e[2]).join("")

  // Printable projection of the stream and, per projected char, its offset in it.
  const offsets: number[] = []
  let projected = ""
  let from = 0
  for (const m of stream.matchAll(ESCAPE)) {
    for (let i = from; i < m.index; i += 1) offsets.push(i)
    projected += stream.slice(from, m.index)
    from = m.index + m[0].length
  }
  for (let i = from; i < stream.length; i += 1) offsets.push(i)
  projected += stream.slice(from)

  const masked = stream.split("")
  for (const pattern of patterns(literals)) {
    for (const m of projected.matchAll(pattern)) {
      for (let i = m.index; i < m.index + m[0].length; i += 1) masked[offsets[i] as number] = "*"
    }
  }

  let at = 0
  for (const event of outputs) {
    const length = event[2].length
    event[2] = masked.slice(at, at + length).join("")
    at += length
  }
  return `${[header, ...events.map((e) => JSON.stringify(e))].join("\n")}\n`
}

/** Replay `text` and throw at the first screen state showing a match. */
export async function assertCastClean(text: string, literals: readonly string[] = []): Promise<void> {
  const cast = parseCast(text)
  const term = new Terminal({ cols: cast.cols, rows: cast.rows, allowProposedApi: true })
  const checks = patterns(literals)
  let lastMarker = "(before the first cue)"
  try {
    for (const [time, kind, data] of cast.events as CastEvent[]) {
      if (kind === "m") lastMarker = data
      if (kind === "r") {
        const [cols, rows] = data.split("x").map(Number)
        term.resize(cols as number, rows as number)
      }
      if (kind !== "o") continue
      const { promise, resolve } = Promise.withResolvers<void>()
      term.write(data, resolve)
      await promise
      const buffer = term.buffer.active
      let screen = ""
      for (let row = 0; row < term.rows; row += 1) {
        screen += `${buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? ""}\n`
      }
      for (const pattern of checks) {
        pattern.lastIndex = 0
        if (pattern.test(screen)) {
          // The value itself is never echoed: the error would republish it.
          throw new Error(
            `recording shows a redacted-class value at ${time}s (after cue ${JSON.stringify(lastMarker)}); ` +
              "re-route that beat so it never reaches the screen",
          )
        }
      }
    }
  } finally {
    term.dispose()
  }
}
