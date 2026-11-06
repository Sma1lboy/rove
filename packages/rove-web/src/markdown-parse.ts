/**
 * The Markdown an agent writes, as a tree the Chat view draws. Deliberately small and safe: headings, fenced code,
 * lists, quotes, pipe tables, paragraphs, and inline code / bold / italic / http(s) links. There is no raw HTML and
 * no other URL scheme, so a message can never inject markup or a `javascript:` link into the page.
 */

export type Inline =
  | { readonly t: "text"; readonly v: string }
  | { readonly t: "code"; readonly v: string }
  | { readonly t: "bold"; readonly c: readonly Inline[] }
  | { readonly t: "em"; readonly c: readonly Inline[] }
  | { readonly t: "link"; readonly href: string; readonly c: readonly Inline[] }

export type Block =
  | { readonly t: "heading"; readonly level: number; readonly c: readonly Inline[] }
  | { readonly t: "para"; readonly c: readonly Inline[] }
  | { readonly t: "code"; readonly lang: string; readonly v: string }
  | {
      readonly t: "list"
      readonly ordered: boolean
      readonly items: readonly { readonly depth: number; readonly c: readonly Inline[] }[]
    }
  | { readonly t: "quote"; readonly c: readonly Inline[] }
  | { readonly t: "table"; readonly rows: readonly (readonly (readonly Inline[])[])[] }
  | { readonly t: "hr" }

const LINK = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/
const BARE_URL = /^https?:\/\/[^\s<>)\]]+/
const WORD = /[\p{L}\p{N}]/u

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let plain = ""
  const flush = () => {
    if (plain) out.push({ t: "text", v: plain })
    plain = ""
  }
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    const ch = text[i] ?? ""
    if (ch === "`") {
      const end = text.indexOf("`", i + 1)
      if (end > i + 1) {
        flush()
        out.push({ t: "code", v: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    } else if (rest.startsWith("**")) {
      const end = text.indexOf("**", i + 2)
      if (end > i + 2) {
        flush()
        out.push({ t: "bold", c: parseInline(text.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    } else if (ch === "*" || (ch === "_" && !WORD.test(text[i - 1] ?? ""))) {
      const end = text.indexOf(ch, i + 1)
      const closes = end > i + 1 && !/\s/.test(text[i + 1] ?? " ") && (ch === "*" || !WORD.test(text[end + 1] ?? ""))
      if (closes) {
        flush()
        out.push({ t: "em", c: parseInline(text.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    } else if (ch === "[") {
      const m = LINK.exec(rest)
      if (m) {
        flush()
        out.push({ t: "link", href: m[2] as string, c: parseInline(m[1] as string) })
        i += m[0].length
        continue
      }
    } else if (ch === "h" && !WORD.test(text[i - 1] ?? "")) {
      const m = BARE_URL.exec(rest)
      if (m) {
        // A sentence's closing punctuation is not part of the address.
        const url = m[0].replace(/[.,;:!?]+$/, "")
        flush()
        out.push({ t: "link", href: url, c: [{ t: "text", v: url }] })
        i += url.length
        continue
      }
    }
    plain += ch
    i++
  }
  flush()
  return out
}

const FENCE = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET = /^(\s*)([-*+])\s+(.*)$/
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim())

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const blocks: Block[] = []
  let para: string[] = []
  const endPara = () => {
    if (para.length > 0) blocks.push({ t: "para", c: parseInline(para.join("\n")) })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    const fence = FENCE.exec(line)
    if (fence) {
      endPara()
      const mark = (fence[1] as string)[0] as string
      const body: string[] = []
      for (i++; i < lines.length && !new RegExp(`^\\s*${mark}{3,}\\s*$`).test(lines[i] as string); i++) {
        body.push(lines[i] as string)
      }
      blocks.push({ t: "code", lang: fence[2] ?? "", v: body.join("\n") })
      continue
    }
    if (line.trim() === "") {
      endPara()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      endPara()
      blocks.push({ t: "heading", level: (heading[1] as string).length, c: parseInline(heading[2] as string) })
      continue
    }
    if (RULE.test(line)) {
      endPara()
      blocks.push({ t: "hr" })
      continue
    }
    if (TABLE_ROW.test(line)) {
      endPara()
      const rows: string[][] = []
      for (; i < lines.length && TABLE_ROW.test(lines[i] as string); i++) {
        const row = lines[i] as string
        if (!TABLE_RULE.test(row)) rows.push(cells(row))
      }
      i--
      blocks.push({ t: "table", rows: rows.map((row) => row.map((cell) => parseInline(cell))) })
      continue
    }
    if (line.startsWith(">")) {
      endPara()
      const body: string[] = []
      for (; i < lines.length && (lines[i] as string).startsWith(">"); i++) {
        body.push((lines[i] as string).replace(/^>\s?/, ""))
      }
      i--
      blocks.push({ t: "quote", c: parseInline(body.join("\n")) })
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    if (bullet || numbered) {
      endPara()
      const ordered = !bullet
      const items: { depth: number; c: Inline[] }[] = []
      for (; i < lines.length; i++) {
        const item = ordered ? NUMBERED.exec(lines[i] as string) : BULLET.exec(lines[i] as string)
        if (!item) break
        const indent = (item[1] as string).length
        items.push({
          depth: Math.min(3, Math.floor(indent / 2)),
          c: parseInline(ordered ? (item[2] as string) : (item[3] as string)),
        })
      }
      i--
      blocks.push({ t: "list", ordered, items })
      continue
    }
    para.push(line)
  }
  endPara()
  return blocks
}
