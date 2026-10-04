/**
 * Split styles: persisted values normalize, and each style frames a pane the
 * way its name promises, keeping neighbouring edges from fusing.
 */

import { RGBA } from "@opentui/core"
import { describe, expect, it } from "vitest"
import { normalizeSplitStyle } from "../../src/state/split-style"
import { groupChrome, paneBoxProps, paneChrome } from "../../src/tui/workspace/split-chrome"

describe("split chrome", () => {
  it("keeps every known style and falls back to box", () => {
    for (const style of ["box", "line", "rail", "rule"]) expect(normalizeSplitStyle(style)).toBe(style)
    expect(normalizeSplitStyle("field")).toBe("box")
    expect(normalizeSplitStyle(undefined)).toBe("box")
  })

  it("box frames each pane; line draws only the edge shared with the previous sibling", () => {
    expect(paneChrome("box", "left").border).toBe(true)
    expect(paneChrome("line", undefined).border).toBe(false)
    expect(paneChrome("line", "top").border).toEqual(["top"])
  })

  it("rail draws a left bar and gaps stacked panes so their bars stay apart", () => {
    const rail = paneChrome("rail", "top")
    expect(rail.border).toEqual(["left"])
    expect(rail.customBorderChars?.vertical).toBe("▎")
    expect(rail.marginTop).toBe(1)
    expect(paneChrome("rail", "left").marginTop).toBe(0)
  })

  it("rule puts the name on a top rule and gaps side-by-side panes so their rules stay apart", () => {
    const rule = paneChrome("rule", "left")
    expect(rule).toMatchObject({ border: ["top"], nameOnRule: true, marginLeft: 1 })
    const ink = RGBA.fromInts(200, 120, 90)
    expect(paneBoxProps(rule, { edge: ink, name: "zsh 2", nameInk: ink })).toMatchObject({
      title: " zsh 2 ",
      titleAlignment: "right",
    })
    expect(groupChrome("rule", "left")).toMatchObject({ border: false, marginLeft: 1, nameOnRule: false })
  })

  it("leaves borderColor off an edgeless pane, which opentui would turn into a full frame", () => {
    const ink = RGBA.fromInts(1, 2, 3)
    expect(paneBoxProps(paneChrome("line", undefined), { edge: ink })).not.toHaveProperty("borderColor")
    expect(paneBoxProps(paneChrome("line", "left"), { edge: ink })).toHaveProperty("borderColor", ink)
  })
})
