/**
 * Release notes as the web shows them: the changelog markdown (Changesets output) rendered as
 * headings, bullets and clickable links instead of the TUI's raw text. Only the subset the
 * changelog uses — `#` headings, `-` bullets with wrapped continuation lines, `[text](url)`,
 * `` `code` `` and `**bold**` — and built as React elements, never as HTML.
 */

import type { ReactNode } from "react"

type Block = { kind: "heading" | "item" | "para"; text: string; id: number }

/** Changesets prefixes each entry with the commit's short-sha link and ends it with the author; the PR link stays. */
function trimEntry(text: string): string {
  return text
    .replace(/\[`[0-9a-f]{7,40}`\]\([^)]*\)\s*/g, "")
    .replace(/\s+[—-]\s+\[@[^\]]+\]\([^)]*\)\s*$/, "")
    .trim()
}

export function parseReleaseNotes(body: string): Block[] {
  const blocks: Block[] = []
  const push = (kind: Block["kind"], text: string) => blocks.push({ kind, text, id: blocks.length })
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (line.trim() === "") continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      push("heading", heading[1] ?? "")
      continue
    }
    const item = /^\s*[-*]\s+(.*)$/.exec(line)
    if (item) {
      push("item", item[1] ?? "")
      continue
    }
    const last = blocks.at(-1)
    // A wrapped line continues the bullet or paragraph above it.
    if (last && last.kind !== "heading") last.text = `${last.text} ${line.trim()}`
    else push("para", line.trim())
  }
  return blocks.map((block) => (block.kind === "item" ? { ...block, text: trimEntry(block.text) } : block))
}

const INLINE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g

export function inlineMarkdown(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let at = 0
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0
    if (start > at) out.push(text.slice(at, start))
    const [whole, label, url, code, bold] = match
    if (label !== undefined && url !== undefined) {
      out.push(
        <a key={start} href={url} target="_blank" rel="noopener noreferrer">
          {inlineMarkdown(label)}
        </a>,
      )
    } else if (code !== undefined) out.push(<code key={start}>{code}</code>)
    else if (bold !== undefined) out.push(<b key={start}>{bold}</b>)
    at = start + whole.length
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}

export function ReleaseNotes({ body }: { body: string }) {
  const blocks = parseReleaseNotes(body)
  const out: ReactNode[] = []
  let items: ReactNode[] = []
  const flush = () => {
    if (items.length > 0) out.push(<ul key={`ul-${out.length}`}>{items}</ul>)
    items = []
  }
  for (const block of blocks) {
    if (block.kind === "item") {
      items.push(<li key={block.id}>{inlineMarkdown(block.text)}</li>)
      continue
    }
    flush()
    out.push(
      block.kind === "heading" ? (
        <h3 key={block.id}>{block.text}</h3>
      ) : (
        <p key={block.id}>{inlineMarkdown(block.text)}</p>
      ),
    )
  }
  flush()
  return <div className="release-md">{out}</div>
}
