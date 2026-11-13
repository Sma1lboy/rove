/**
 * Single-line dialog fields (title, branch, repo, prompt) normalize with
 * `stripNewlines`; the feedback description is a `<textarea>` and is NOT
 * stripped, so a pasted multi-line report keeps its paragraphs.
 */

import { stripNewlines } from "@/tui/component/new-task-dialog/state"
import { describe, expect, it } from "vitest"

describe("single-line fields still strip newlines (title / branch / prompt / repo)", () => {
  it("stripNewlines collapses CR/LF so those fields stay on one line", () => {
    expect(stripNewlines("one\ntwo")).toBe("onetwo")
    expect(stripNewlines("a\r\nb\n")).toBe("ab")
    expect(stripNewlines("clean")).toBe("clean")
  })
})
