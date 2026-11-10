/**
 * The tab strip and the sidebar rail must describe one tab the same way.
 *
 * Both draw the daemon's row status through `rowStatusGlyph`; what is left to
 * pin on this side is the strip's TOAST vocabulary, read off the same status
 * (`notifyTurns`): the three attention reasons still raise an attention toast,
 * a finished turn nobody has seen raises `done`, and a restored session —
 * which the daemon reports on every host restart — announces nothing.
 *
 * Lives on the render track because `use-tab-turn-state.ts` pulls in opentui,
 * which needs bun's runner.
 */
import { describe, expect, it } from "bun:test"
import type { TabStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import { rowStatusGlyph } from "../../src/lib/row-status-glyph"
import { notifyTurns } from "../../src/tui-react/workspace/use-tab-turn-state"
import { DEFAULT_GLYPHS } from "../../src/tui/lib/glyphs"
import { chipAttentionKind } from "../../src/tui/lib/notify-state"

const SESSION = { alive: true, restored: false, tracked: true } as const

const attention = (reason: TabStatus["reason"]): TabStatus => ({ kind: "attention", reason, since: 1, ...SESSION })

describe("tab strip status agrees with the sidebar rail", () => {
  it("draws a rate limit amber and an error or dead engine red", () => {
    expect(rowStatusGlyph(attention("rate_limited"), DEFAULT_GLYPHS).tone).toBe("warning")
    expect(rowStatusGlyph(attention("error"), DEFAULT_GLYPHS).tone).toBe("error")
    expect(rowStatusGlyph(attention("dead"), DEFAULT_GLYPHS).tone).toBe("error")
  })

  it("still raises an attention notification for all three", () => {
    const turns = notifyTurns({
      a: attention("rate_limited"),
      b: attention("error"),
      c: attention("dead"),
    })
    for (const tab of ["a", "b", "c"]) expect(chipAttentionKind(turns?.get(tab) ?? "")).toBe("error")
  })

  it("toasts an unseen finish and a question, never a restored session", () => {
    const turns = notifyTurns({
      done: { kind: "unseen", since: 1, ...SESSION },
      asks: { kind: "needs-input", since: 1, ...SESSION },
      thawed: attention("restored"),
      quiet: { kind: "idle", since: 1, ...SESSION },
    })
    expect(chipAttentionKind(turns?.get("done") ?? "")).toBe("done")
    expect(chipAttentionKind(turns?.get("asks") ?? "")).toBe("needs_input")
    expect(chipAttentionKind(turns?.get("thawed") ?? "")).toBeNull()
    expect(chipAttentionKind(turns?.get("quiet") ?? "")).toBeNull()
  })

  it("waits for the daemon before seeding: no status yet is not an empty task", () => {
    expect(notifyTurns(undefined)).toBeNull()
  })
})
