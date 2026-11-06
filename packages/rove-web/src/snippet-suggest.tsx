/**
 * `@name` in a prompt field: a list of the saved snippets whose name starts with what was typed, in the
 * suggest list's look. Up/Down move the highlight, Tab or Enter (or a tap) swaps the `@word` for the snippet's
 * text, Esc closes. With the list closed every key reaches the field as before, so Enter still sends.
 */

import {
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { type Snippet, expandSnippet, matchSnippets, snippetToken, useSnippets } from "./snippets.ts"
import { SUGGEST_LIST, suggestRowClass } from "./ui/text.ts"

const firstLine = (text: string): string => text.split("\n", 1)[0] ?? ""

function SnippetList(props: {
  items: readonly Snippet[]
  at: number
  className: string
  onPick: (index: number) => void
}) {
  return (
    <ul className={`${SUGGEST_LIST} ${props.className}`}>
      {props.items.map((item, i) => (
        <li key={item.name}>
          <button
            type="button"
            tabIndex={-1}
            aria-pressed={i === props.at}
            className={suggestRowClass({ cursor: i === props.at, accent: false })}
            onMouseDown={(e) => {
              e.preventDefault()
              props.onPick(i)
            }}
          >
            <span className="text-accent">@{item.name}</span>
            <span className="text-muted"> {firstLine(item.text)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function useSnippetSuggest(o: {
  value: string
  onChange: (value: string) => void
  area: RefObject<HTMLTextAreaElement | null>
  /** Classes placing the list: under the field by default, or floated over a fixed-height bar. */
  listClassName?: string
}) {
  const all = useSnippets()
  const [caret, setCaret] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [closed, setClosed] = useState<number | null>(null)
  const landing = useRef<number | null>(null)
  const token = snippetToken(o.value, Math.min(caret, o.value.length))
  const items = token ? matchSnippets(all, token.query) : []
  const shown = token !== null && items.length > 0 && closed !== token.start
  const at = Math.min(cursor, Math.max(0, items.length - 1))

  // The text is replaced by React first; the caret can only follow once the field holds the new value.
  useLayoutEffect(() => {
    const to = landing.current
    const field = o.area.current
    if (to === null || !field) return
    landing.current = null
    field.setSelectionRange(to, to)
    setCaret(to)
  })

  const pick = (index: number) => {
    const snippet = items[index]
    if (!token || !snippet) return
    const next = expandSnippet(o.value, token, snippet)
    landing.current = next.caret
    setCursor(0)
    o.onChange(next.text)
  }

  return {
    list: shown ? <SnippetList items={items} at={at} className={o.listClassName ?? ""} onPick={pick} /> : null,
    /** The field's `onChange`. */
    change: (e: ChangeEvent<HTMLTextAreaElement>) => {
      setCaret(e.target.selectionStart)
      setCursor(0)
      o.onChange(e.target.value)
    },
    /** The field's `onSelect`: the caret moved without the text changing. */
    select: (e: { currentTarget: HTMLTextAreaElement }) => setCaret(e.currentTarget.selectionStart),
    /** The field's `onKeyDown`, before its own handling; true = the list took the key. */
    key: (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!shown || e.nativeEvent.isComposing) return false
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setCursor(Math.max(0, Math.min(items.length - 1, at + (e.key === "ArrowDown" ? 1 : -1))))
      } else if ((e.key === "Tab" && !e.shiftKey) || (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey)) {
        pick(at)
      } else if (e.key === "Escape") {
        setClosed(token?.start ?? null)
        e.stopPropagation()
      } else return false
      e.preventDefault()
      return true
    },
  }
}
