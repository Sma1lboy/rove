import { describe, expect, test } from "bun:test"
import { withImagePlaceholders as tuiWithImagePlaceholders } from "@sma1lboy/rove/src/state/issue-chat.ts"
import { attachableFiles, nextPlaceholderIndex, withImagePlaceholders } from "../src/kanban-attach.ts"

describe("story description attachments", () => {
  test("placeholder lines are exactly what the TUI drawer writes", () => {
    const paths = ["/a/shot.png", "/a/spec.pdf", "/a/two.jpg"]
    for (const body of ["", "text", "text\n\n", "images[3]: /x.png\nmore"]) {
      expect(withImagePlaceholders(body, paths)).toBe(tuiWithImagePlaceholders(body, paths))
    }
  })

  test("a deleted middle line never mints a duplicate label", () => {
    expect(nextPlaceholderIndex("images[0]: /a.png\npdf[2]: /b.pdf")).toBe(3)
    expect(nextPlaceholderIndex("no attachments")).toBe(0)
  })

  test("only the types attachment.put accepts are taken from a paste or drop", () => {
    const file = (type: string) => new File(["x"], "f", { type })
    const kept = attachableFiles([
      file("image/png"),
      file("text/plain"),
      file("application/pdf"),
      file("image/svg+xml"),
    ])
    expect(kept.map((f) => f.type)).toEqual(["image/png", "application/pdf"])
  })
})
