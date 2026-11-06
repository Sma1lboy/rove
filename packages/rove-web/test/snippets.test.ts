import { describe, expect, test } from "bun:test"
import { expandSnippet, matchSnippets, snippetToken } from "../src/snippets.ts"

describe("snippetToken", () => {
  test("an @word at the caret, at the start or after whitespace", () => {
    expect(snippetToken("@rev", 4)).toEqual({ start: 0, end: 4, query: "rev" })
    expect(snippetToken("please @rev", 11)).toEqual({ start: 7, end: 11, query: "rev" })
    expect(snippetToken("a\n@", 3)).toEqual({ start: 2, end: 3, query: "" })
  })
  test("an email, a path or a caret past the word is not a snippet", () => {
    expect(snippetToken("me@rev", 6)).toBeNull()
    expect(snippetToken("@src/a", 6)).toBeNull()
    expect(snippetToken("@rev ", 5)).toBeNull()
  })
  test("a caret inside the word takes the rest of it along", () => {
    expect(snippetToken("@review", 4)).toEqual({ start: 0, end: 7, query: "rev" })
  })
})

describe("matchSnippets", () => {
  const all = [
    { name: "review-all", text: "a" },
    { name: "Review", text: "b" },
    { name: "tests", text: "c" },
  ]
  test("prefix, case-insensitive, the exact name first", () => {
    expect(matchSnippets(all, "rev").map((s) => s.name)).toEqual(["review-all", "Review"])
    expect(matchSnippets(all, "review").map((s) => s.name)).toEqual(["Review", "review-all"])
    expect(matchSnippets(all, "").length).toBe(3)
    expect(matchSnippets(all, "zzz")).toEqual([])
  })
})

describe("expandSnippet", () => {
  test("replaces the whole @word and puts the caret after the text", () => {
    const text = "fix this @rev now"
    const token = snippetToken(text, 13)
    if (!token) throw new Error("no token")
    expect(expandSnippet(text, token, { name: "review", text: "Review carefully." })).toEqual({
      text: "fix this Review carefully. now",
      caret: 26,
    })
  })
})
