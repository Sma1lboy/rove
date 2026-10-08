import { describe, expect, it } from "vitest"
import { paintDemoFrame } from "../../src/demo/render.ts"
import { demoFrameAt, demoLoopElapsed } from "../../src/demo/replay.ts"
import { DEMO_SESSION } from "../../src/demo/session-script.ts"
import { contribEngineOffered } from "../../src/engine/account-detect.ts"
import { CONTRIB_ENGINES } from "../../src/engine/contrib-engines.ts"
import { classifyScreen } from "../../src/engine/screen-state.ts"

const lastBeat = DEMO_SESSION.beats[DEMO_SESSION.beats.length - 1]?.atMs ?? 0

describe("demo session script", () => {
  it("is ordered so the visible transcript is always a prefix", () => {
    const times = DEMO_SESSION.beats.map((b) => b.atMs)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(lastBeat).toBeLessThanOrEqual(DEMO_SESSION.durationMs)
  })
})

describe("demoFrameAt", () => {
  it("shows only the first beat at t=0, with a live status", () => {
    const frame = demoFrameAt(DEMO_SESSION, 0)
    expect(frame.lines).toEqual(DEMO_SESSION.beats[0]?.lines)
    expect(frame.status?.label).toBe("Thinking")
  })

  it("grows monotonically and never rewrites an earlier line", () => {
    let previous: readonly string[] = []
    for (let t = 0; t <= DEMO_SESSION.durationMs; t += 250) {
      const texts = demoFrameAt(DEMO_SESSION, t).lines.map((l) => l.text)
      expect(texts.slice(0, previous.length)).toEqual(previous)
      previous = texts
    }
  })

  it("drops the spinner once the script reaches its resting beat", () => {
    expect(demoFrameAt(DEMO_SESSION, lastBeat).status).toBeNull()
    expect(demoFrameAt(DEMO_SESSION, DEMO_SESSION.durationMs + 5000).status).toBeNull()
  })

  it("ramps the token counter to the scripted total", () => {
    expect(demoFrameAt(DEMO_SESSION, 0).status?.tokens).toBe(0)
    expect(demoFrameAt(DEMO_SESSION, DEMO_SESSION.durationMs / 2).status?.tokens).toBeGreaterThan(0)
    expect(
      demoFrameAt(DEMO_SESSION, lastBeat)
        .lines.map((l) => l.text)
        .join("\n"),
    ).toContain("3.4k tokens")
  })

  it("clamps a negative clock instead of throwing", () => {
    expect(demoFrameAt(DEMO_SESSION, -100).lines).toEqual(demoFrameAt(DEMO_SESSION, 0).lines)
  })
})

describe("demoLoopElapsed", () => {
  it("wraps past the script when looping and clamps when not", () => {
    expect(demoLoopElapsed(DEMO_SESSION, DEMO_SESSION.durationMs + 250, true)).toBe(250)
    expect(demoLoopElapsed(DEMO_SESSION, DEMO_SESSION.durationMs + 250, false)).toBe(DEMO_SESSION.durationMs + 250)
  })
})

describe("paintDemoFrame", () => {
  it("clips to the terminal width and parks the status on the last row", () => {
    const out = paintDemoFrame(demoFrameAt(DEMO_SESSION, 0), { cols: 20, rows: 10, color: false })
    expect(out).toContain("\x1b[10;1H")
    // The 60-cell welcome box top is clipped to the 20-cell viewport.
    expect(out).toContain(`╭${"─".repeat(19)}`)
    expect(out).not.toContain("─".repeat(40))
    expect(out).toContain("⠋ Thinking…")
  })

  it("emits no color codes when color is off", () => {
    const out = paintDemoFrame(demoFrameAt(DEMO_SESSION, 0), { cols: 80, rows: 24, color: false })
    expect(out).not.toContain("\x1b[38;5;")
  })
})

describe("demo engine registration", () => {
  it("stays out of the selector until ROVE_DEMO_ENGINE is set", () => {
    const spec = CONTRIB_ENGINES.demo
    expect(spec?.requiresEnv).toBe("ROVE_DEMO_ENGINE")
    const which = (bin: string) => (bin === "absent" ? null : `/usr/bin/${bin}`)
    const off = () => undefined
    const on = (name: string) => (name === "ROVE_DEMO_ENGINE" ? "1" : undefined)
    expect(contribEngineOffered(spec, off, which)).toBe(false)
    expect(contribEngineOffered(spec, on, which)).toBe(true)
    // An unmet requiresEnv is not rescued by the binary being present.
    expect(contribEngineOffered({ ...spec, requiresEnv: "NOPE" }, on, which)).toBe(false)
    // And a set requiresEnv is not enough when the launch binary is missing.
    expect(contribEngineOffered({ ...spec, defaultCommand: ["absent"] }, on, which)).toBe(false)
  })

  it("reads its own screen states", () => {
    const manifest = CONTRIB_ENGINES.demo?.screenManifest
    if (!manifest) throw new Error("demo engine has no screen manifest")
    expect(classifyScreen(manifest, "transcript…\n⠹ Running tests… · 4.2s · ↑ 1.2k tokens")).toBe("working")
    expect(classifyScreen(manifest, "│  ❯ 1. Yes\n│    2. Yes, and don't ask again this session")).toBe("blocked")
    expect(classifyScreen(manifest, "✻ Worked for 14.6s · 3.4k tokens\n\n> ")).toBe("idle")
    // A transcript that is neither working nor at the composer stays unread,
    // rather than flapping the badge.
    expect(classifyScreen(manifest, "● Read(src/queue.ts)\n  ⎿  Read 84 lines")).toBeNull()
  })
})
