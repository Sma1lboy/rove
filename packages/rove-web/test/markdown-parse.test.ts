import { describe, expect, test } from "bun:test"
import { parseInline, parseMarkdown } from "../src/markdown-parse.ts"

describe("parseMarkdown", () => {
  test("an agent's usual reply: heading, prose, a list, fenced code with its language, a quote", () => {
    const blocks = parseMarkdown(
      [
        "## Plan",
        "First line",
        "second line",
        "",
        "- one",
        "  - nested",
        "2. two",
        "",
        "```ts",
        "const a = 1",
        "",
        "```",
        "> note",
      ].join("\n"),
    )
    expect(blocks.map((b) => b.t)).toEqual(["heading", "para", "list", "list", "code", "quote"])
    expect(blocks[4]).toEqual({ t: "code", lang: "ts", v: "const a = 1\n" })
    const bullets = blocks[2]
    expect(bullets?.t === "list" && bullets.items.map((i) => i.depth)).toEqual([0, 1])
  })

  test("an unclosed fence runs to the end, and a fence's own Markdown is left alone", () => {
    const blocks = parseMarkdown("```\n# not a heading\n**not bold**")
    expect(blocks).toEqual([{ t: "code", lang: "", v: "# not a heading\n**not bold**" }])
  })

  test("a pipe table keeps its rows and drops the divider row", () => {
    const [table] = parseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")
    expect(table?.t === "table" && table.rows.length).toBe(2)
  })
})

describe("parseInline", () => {
  test("code, bold and italic, but not a snake_case word", () => {
    expect(parseInline("run `ls` **now** *ok* snake_case_name").map((n) => n.t)).toEqual([
      "text",
      "code",
      "text",
      "bold",
      "text",
      "em",
      "text",
    ])
  })

  test("only http(s) links become links; the sentence's closing dot is not part of a bare address", () => {
    const nodes = parseInline("[x](https://a.dev/p) [bad](javascript:alert(1)) see https://b.dev/q.")
    const hrefs = nodes.flatMap((n) => (n.t === "link" ? [n.href] : []))
    expect(hrefs).toEqual(["https://a.dev/p", "https://b.dev/q"])
    expect(JSON.stringify(nodes)).not.toContain('"href":"javascript')
  })

  test("HTML is plain text, never markup", () => {
    expect(parseInline("<script>x</script>")).toEqual([{ t: "text", v: "<script>x</script>" }])
  })
})
