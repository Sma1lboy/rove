import { describe, expect, test } from "bun:test"
import { withImagePlaceholders as tuiWithImagePlaceholders } from "@sma1lboy/rove/src/state/issue-chat.ts"
import { nextPlaceholderIndex, withImagePlaceholders } from "../src/kanban-attach.ts"

describe("story description attachments", () => {
  test("placeholder lines are exactly what the TUI drawer writes", () => {
    const paths = ["/a/shot.png", "/a/spec.pdf", "/a/two.jpg", "/a/data.csv"]
    for (const body of ["", "text", "text\n\n", "images[3]: /x.png\nmore"]) {
      expect(withImagePlaceholders(body, paths)).toBe(tuiWithImagePlaceholders(body, paths))
    }
  })

  test("a deleted middle line never mints a duplicate label", () => {
    expect(nextPlaceholderIndex("images[0]: /a.png\npdf[2]: /b.pdf\nfiles[4]: /c.csv")).toBe(5)
    expect(nextPlaceholderIndex("no attachments")).toBe(0)
  })
})
