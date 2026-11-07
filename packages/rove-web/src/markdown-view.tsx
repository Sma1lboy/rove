/** An agent's Markdown drawn as the page's own elements (see `markdown-parse.ts` for what is understood). */

import { Children, Fragment, type ReactNode, useMemo } from "react"
import { type Block, type Inline, parseMarkdown } from "./markdown-parse.ts"
import { SEARCH_MARK } from "./ui/search.ts"
import * as s from "./ui/transcript.ts"

/** `text` with each case-insensitive `needle` wrapped in a mark. */
export function markText(text: string, needle: string): ReactNode {
  const n = needle.trim().toLowerCase()
  if (!n) return text
  const lower = text.toLowerCase()
  const parts: ReactNode[] = []
  let from = 0
  for (let at = lower.indexOf(n); at >= 0; at = lower.indexOf(n, from)) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark key={at} className={SEARCH_MARK} data-hit="">
        {text.slice(at, at + n.length)}
      </mark>,
    )
    from = at + n.length
  }
  parts.push(text.slice(from))
  return Children.toArray(parts)
}

const HEADINGS = ["h3", "h3", "h4", "h5", "h6", "h6"] as const

function Heading({ level, children }: { level: number; children: ReactNode }) {
  const Tag = HEADINGS[Math.min(5, Math.max(0, level - 1))] ?? "h6"
  return <Tag className={s.MD_H}>{children}</Tag>
}

/** `items` drawn in order. Markdown nodes carry no ids, so their place is their key. */
function each<T>(items: readonly T[], render: (item: T) => ReactNode): ReactNode[] {
  // biome-ignore lint/suspicious/noArrayIndexKey: a parsed message is never reordered
  return items.map((item, i) => <Fragment key={i}>{render(item)}</Fragment>)
}

function InlineView({ nodes, needle }: { nodes: readonly Inline[]; needle: string }): ReactNode {
  return each(nodes, (node) => {
    if (node.t === "text") return markText(node.v, needle)
    if (node.t === "code") return <code className={s.MD_CODE}>{markText(node.v, needle)}</code>
    if (node.t === "bold") {
      return (
        <strong>
          <InlineView nodes={node.c} needle={needle} />
        </strong>
      )
    }
    if (node.t === "em") {
      return (
        <em>
          <InlineView nodes={node.c} needle={needle} />
        </em>
      )
    }
    return (
      <a className={s.MD_LINK} href={node.href} target="_blank" rel="noopener noreferrer">
        <InlineView nodes={node.c} needle={needle} />
      </a>
    )
  })
}

function BlockView({ block, needle }: { block: Block; needle: string }) {
  switch (block.t) {
    case "heading":
      return (
        <Heading level={block.level}>
          <InlineView nodes={block.c} needle={needle} />
        </Heading>
      )
    case "para":
      return (
        <p className={s.MD_P}>
          <InlineView nodes={block.c} needle={needle} />
        </p>
      )
    case "code":
      return (
        <pre className={s.MD_PRE}>
          <code>{markText(block.v, needle)}</code>
        </pre>
      )
    case "quote":
      return (
        <blockquote className={s.MD_QUOTE}>
          <InlineView nodes={block.c} needle={needle} />
        </blockquote>
      )
    case "hr":
      return <hr className={s.MD_RULE} />
    case "list": {
      const Tag = block.ordered ? "ol" : "ul"
      return (
        <Tag className={`${s.MD_LIST} ${block.ordered ? "list-decimal" : "list-disc"}`}>
          {each(block.items, (item) => (
            <li style={{ marginLeft: `${item.depth * 1.25}rem` }}>
              <InlineView nodes={item.c} needle={needle} />
            </li>
          ))}
        </Tag>
      )
    }
    case "table":
      return (
        <table className={s.MD_TABLE}>
          <tbody>
            {each(block.rows, (row) => (
              <tr>
                {each(row, (cell) => (
                  <td className={s.MD_CELL}>
                    <InlineView nodes={cell} needle={needle} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
  }
}

export function MarkdownView({ source, needle = "" }: { source: string; needle?: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return (
    <div className={s.MD}>
      {each(blocks, (block) => (
        <BlockView block={block} needle={needle} />
      ))}
    </div>
  )
}
