import { MOD_TREE_MAX_NODES, parseModUiPayload, validateModTree } from "@sma1lboy/rove-plugin-sdk/contract"
import { describe, expect, it } from "vitest"

const counter = {
  type: "box",
  direction: "row",
  gap: 2,
  children: [
    { type: "button", key: "inc", label: "Add one" },
    { type: "text", text: "Count: 3", tone: "info", bold: true },
  ],
}

describe("validateModTree", () => {
  it("accepts a tree every host can draw", () => {
    expect(validateModTree(counter)).toEqual({ ok: true, tree: counter })
  })

  it("refuses a prop a host would have to guess at", () => {
    const result = validateModTree({ type: "text", text: "hi", color: "#f00" })
    expect(result).toEqual({ ok: false, error: 'tree: text has no prop "color"' })
  })

  it("refuses an element some host lacks", () => {
    expect(validateModTree({ type: "box", children: [{ type: "svg" }] }).ok).toBe(false)
  })

  it("refuses two buttons on one key, since a press could not tell them apart", () => {
    const tree = {
      type: "box",
      children: [
        { type: "button", key: "x", label: "A" },
        { type: "button", key: "x", label: "B" },
      ],
    }
    expect(validateModTree(tree)).toEqual({ ok: false, error: 'tree.children[1]: duplicate key "x"' })
  })

  it("refuses a tree past the element budget", () => {
    const children = Array.from({ length: MOD_TREE_MAX_NODES }, () => ({ type: "text", text: "." }))
    expect(validateModTree({ type: "box", children }).ok).toBe(false)
  })
})

describe("parseModUiPayload", () => {
  it("drops a pane whose tree is invalid and keeps the rest", () => {
    const panes = parseModUiPayload({
      panes: [
        { plugin: "a", id: "main", title: "A", tree: counter },
        { plugin: "b", id: "main", title: "B", tree: { type: "img" } },
      ],
    })
    expect(panes?.map((p) => p.plugin)).toEqual(["a"])
  })
})
