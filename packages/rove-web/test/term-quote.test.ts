import { describe, expect, test } from "bun:test"
import { fenceQuote } from "../src/term-quote.ts"

describe("fenceQuote", () => {
  test("a selection becomes a fenced block, trimmed of terminal padding and blank edges", () => {
    expect(fenceQuote("\n  error: boom   \n    at x   \n\n")).toBe("```\n  error: boom\n    at x\n```\n")
  })
  test("a selection holding backticks gets a longer fence so it can't close early", () => {
    expect(fenceQuote("run ```ts\nx\n```")).toBe("````\nrun ```ts\nx\n```\n````\n")
  })
  test("only whitespace quotes nothing", () => {
    expect(fenceQuote("  \n \n")).toBeNull()
  })
})
