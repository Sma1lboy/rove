import { homedir } from "node:os"
import { describe, expect, it } from "vitest"
import { assertCastClean, redactCast } from "../e2e/film/redact.ts"
import { frameTimes } from "../e2e/film/film.ts"
import { type Cast, parseCast, planSeek } from "../src/lib/cast.ts"

const cast = (events: unknown[][]): string =>
  `${[{ version: 2, width: 40, height: 4 }, ...events].map((e) => JSON.stringify(e)).join("\n")}\n`

describe("planSeek", () => {
  const recording: Cast = parseCast(
    cast([
      [0.1, "o", "a"],
      [0.2, "o", "b"],
      [0.3, "r", "50x5"],
      [0.4, "m", "beat"],
      [0.5, "o", "c"],
    ]),
  )

  it("applies only the gap on a forward seek, output coalesced around resizes", () => {
    expect(planSeek(recording, 0, 0.45)).toEqual({
      reset: false,
      steps: [
        { kind: "write", data: "ab" },
        { kind: "resize", cols: 50, rows: 5 },
      ],
      cursor: 4,
    })
    expect(planSeek(recording, 4, 1)).toEqual({ reset: false, steps: [{ kind: "write", data: "c" }], cursor: 5 })
  })

  it("replays from the top when seeking before what was applied", () => {
    expect(planSeek(recording, 5, 0.15)).toEqual({ reset: true, steps: [{ kind: "write", data: "a" }], cursor: 1 })
  })
})

describe("frameTimes", () => {
  const markers = [
    { t: 1, label: "open" },
    { t: 4, label: "end" },
  ]

  it("samples each segment at its rate", () => {
    expect(frameTimes([{ from: "open", to: "end", rate: 3 }], markers, 2)).toEqual([1, 2.5])
    expect(frameTimes([{ from: 0, to: "open", rate: 1 }], markers, 2)).toEqual([0, 0.5])
    expect(frameTimes([{ from: { cue: "open", offset: 0.5 }, to: { cue: "end", offset: -2 }, rate: 1 }], markers, 2)).toEqual([1.5])
  })

  it("refuses a cue the take never recorded", () => {
    expect(() => frameTimes([{ from: "open", to: "gone", rate: 1 }], markers, 24)).toThrow(/gone/)
  })
})

describe("redactCast", () => {
  const outputs = (text: string): string[] =>
    parseCast(text)
      .events.filter((e) => e[1] === "o")
      .map((e) => e[2])

  it("masks an address split across chunks and styling, keeping every column", () => {
    const raw = cast([
      [0.1, "o", "\x1b(Bby me@exa"],
      [0.2, "o", "\x1b[1mmple.com\x1b[0m ok"],
    ])
    expect(outputs(redactCast(raw))).toEqual(["\x1b(Bby ******", "\x1b[1m********\x1b[0m ok"])
  })

  it("masks registered literals", () => {
    expect(outputs(redactCast(cast([[0.1, "o", "key sk-0123456789abcdef!"]]), ["sk-0123456789abcdef"]))).toEqual([
      "key *******************!",
    ])
  })

  it("drops off-screen OSC strings, even split across chunks, and keeps what the screen shows", () => {
    const raw = cast([
      [0.1, "o", "a\x1b]7;file://host/home/op"],
      [0.2, "o", "/repo\x07b\x1b]12;#fff\x07"],
      [0.3, "o", "\x1b]0;title\x1b\\c"],
    ])
    expect(outputs(redactCast(raw))).toEqual(["a", "b\x1b]12;#fff\x07", "c"])
  })

  it("rejects a recording whose screen still shows an address", async () => {
    // Painted in cursor-positioned fragments, as a diffing TUI may: no run of
    // the stream contains it, the screen does.
    const raw = cast([
      [0.1, "o", "\x1b[1;4Hexample.com"],
      [0.2, "o", "\x1b[1;1Hme@"],
    ])
    await expect(assertCastClean(redactCast(raw))).rejects.toThrow(/0\.2s/)
    await expect(assertCastClean(cast([[0.1, "o", "clean screen"]]))).resolves.toBeUndefined()
  })

  it("rejects a recording that names the operator's home anywhere in its bytes", async () => {
    const leaked = cast([[0.1, "o", `\x1b]1337;CurrentDir=${homedir()}\x07`]])
    await expect(assertCastClean(leaked)).rejects.toThrow(/HERO_ROOT/)
  })
})
