/**
 * Keep the operator's identity out of a committed recording.
 *
 * `HOME` stays the operator's during a take (the engine needs its login — see
 * `hero-env.ts`), so an e-mail address, a path or a registered secret can
 * reach the PTY. Three passes:
 *
 *  1. `redactCast` drops the OSC strings nobody sees — titles, cwd reports,
 *     hyperlink targets, clipboard writes — which carry paths and never reach
 *     the screen, so no screen check could catch them.
 *  2. It then masks on-screen matches with `*`, one per code unit, so every
 *     column after it stays where the TUI put it. Matching runs over the
 *     stream with escape sequences removed and chunk boundaries joined,
 *     because a styled or split address is still an address on screen.
 *  3. `assertCastClean` fails if the bytes still name the operator, then
 *     replays through a headless xterm and fails if any screen state shows a
 *     match — a TUI that paints a value in cursor-positioned fragments slips
 *     past pass 2, and must not slip past this. A failed take is re-shot on a
 *     route that never shows the value.
 */

import { homedir, userInfo } from "node:os"
import { Terminal } from "@xterm/headless"
import { type CastEvent, parseCast } from "../../src/lib/cast.ts"

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g

// Title (0/1/2), cwd (7), hyperlink (8), clipboard (52).
const OFFSCREEN_OSC = /\x1b\](?:[0127]|8|52);[^\x07\x1b]*(?:\x07|\x1b\\)/g

// CSI, OSC/DCS/APC strings, charset designations (`ESC ( B`), then any other
// two-byte escape — none of their bytes may be masked.
const ESCAPE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[\]P_^][^\x07\x1b]*(?:\x07|\x1b\\)?|[()*+#%][\s\S]|[\s\S])/g

function literalPatterns(literals: readonly string[]): RegExp[] {
  return literals.map((l) => new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))
}

/** Output redacted; header, timing, resizes and markers untouched. */
export function redactCast(text: string, literals: readonly string[] = []): string {
  const [header, ...lines] = text.split("\n").filter((line) => line.length > 0)
  const events = lines.map((line) => JSON.parse(line) as [number, string, string])
  const outputs = events.filter((e) => e[1] === "o")
  const raw = outputs.map((e) => e[2]).join("")

  // Pass 1, on the joined stream so a string split across chunks still goes;
  // each chunk's end moves back by what was dropped before it.
  const dropped = [...raw.matchAll(OFFSCREEN_OSC)].map((m) => [m.index, m.index + m[0].length] as const)
  let end = 0
  const ends = outputs.map((e) => {
    end += e[2].length
    return end - dropped.reduce((n, [s, x]) => n + Math.max(0, Math.min(x, end) - s), 0)
  })
  const stream = raw.replace(OFFSCREEN_OSC, "")

  // Pass 2: the printable projection and, per projected char, its offset.
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
  for (const pattern of [EMAIL, ...literalPatterns(literals)]) {
    for (const m of projected.matchAll(pattern)) {
      for (let i = m.index; i < m.index + m[0].length; i += 1) masked[offsets[i] as number] = "*"
    }
  }

  let at = 0
  for (const [i, event] of outputs.entries()) {
    event[2] = masked.slice(at, ends[i]).join("")
    at = ends[i] as number
  }
  return `${[header, ...events.map((e) => JSON.stringify(e))].join("\n")}\n`
}

/** Throw if `text` names the operator anywhere or any screen state shows a match. */
export async function assertCastClean(text: string, literals: readonly string[] = []): Promise<void> {
  const identity = [homedir(), userInfo().username].filter((v) => v.length >= 4)
  if (identity.some((v) => text.includes(v))) {
    throw new Error(
      "recording contains the operator's home path or user name — point HERO_ROOT at a neutral directory " +
        "(e.g. /tmp/rove-hero) for the fixture, hero-serve.ts and the take",
    )
  }
  // The value itself is never echoed: the error would republish it.
  if (literalPatterns(literals).some((p) => p.test(text))) throw new Error("recording contains a registered secret")

  const cast = parseCast(text)
  const term = new Terminal({ cols: cast.cols, rows: cast.rows, allowProposedApi: true })
  const checks = [EMAIL, ...literalPatterns(literals)]
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
