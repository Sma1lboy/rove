/**
 * A pasted http(s) link shows in the prompt as a badge: the page's icon and a cut title. The textarea holds a
 * short token in its place, so the caret, selection, snippets and dictation stay native; a layer behind the
 * transparent text draws the badge, and a send swaps each token back for its URL.
 */

import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { AppModel } from "./model.ts"
import type { useSnippetSuggest } from "./snippet-suggest.tsx"
import * as L from "./ui/link-badge.ts"

const MARK = "\u2063"
/** The icon's slot in the token: blank in the textarea, the favicon in the layer behind it. */
const SLOT = "\u2003"
/** Breathing room inside the pill: the badge can't take padding without moving the text off the field's. */
const PAD = "\u2009"
/** Word joiner between every character of a token: no line break falls inside a badge, CJK and spaces included. */
const JOIN = "\u2060"
const glue = (text: string) => Array.from(text).join(JOIN)
const HEAD = glue(`${MARK}${PAD}${PAD}${SLOT}${PAD}`) + JOIN
const TAIL = glue(`${PAD}${PAD}${MARK}`)
/** The token: a gap outside the pill, then inside it room, the icon slot, room, the label, room; a gap again. */
const TOKEN = new RegExp(`${HEAD}((?:[^\u2063\u2060\n]${JOIN})*?)${TAIL}`, "gu")
const LABEL_MAX = 22
const LINKS_KEY = "rove.web.newSession.links"

interface Link {
  readonly url: string
  readonly icon?: string
  /** Its title is still being fetched: the badge shimmers. */
  readonly loading?: boolean
}

export const token = (label: string) => `${HEAD}${glue(label)}${JOIN}${TAIL}`
const labelOf = (m: RegExpExecArray) => (m[1] ?? "").replaceAll(JOIN, "")
const clean = (text: string) => Array.from(text.replace(/[\u2063\u2060\n]/g, ""))

function cut(text: string, max = LABEL_MAX): string {
  const chars = clean(text)
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("")
}

/** Host and path before a title arrives, or when there is none; a long one keeps its tail, where links on one site differ. */
function place(url: URL): string {
  const chars = clean(`${url.host}${url.pathname.replace(/\/$/, "")}`)
  return chars.length > LABEL_MAX ? `…${chars.slice(1 - LABEL_MAX).join("")}` : chars.join("")
}

function loadLinks(): Record<string, Link> {
  try {
    return JSON.parse(sessionStorage.getItem(LINKS_KEY) ?? "{}") as Record<string, Link>
  } catch {
    return {}
  }
}

/** The prompt as the agent reads it: each badge back to its URL, a broken token's marks dropped. */
export function expandLinks(text: string, links: Readonly<Record<string, Link>>): string {
  return text
    .replace(TOKEN, (whole, label: string) => links[label.replaceAll(JOIN, "")]?.url ?? whole)
    .replace(/[\u2063\u2060]/g, "")
}

export function useLinkBadges(o: {
  model: AppModel
  value: string
  onChange: (value: string) => void
  area: RefObject<HTMLTextAreaElement | null>
  /** The snippet list's field handlers, which these wrap. */
  field: ReturnType<typeof useSnippetSuggest>["field"]
  /** Pasted files, tried before a pasted link. */
  onFilePaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void
}) {
  const [links, setLinksState] = useState(loadLinks)
  const latest = useRef({ value: o.value, links })
  latest.current = { value: o.value, links }
  const layer = useRef<HTMLDivElement>(null)

  const setLinks = (next: Record<string, Link>): void => {
    latest.current.links = next
    setLinksState(next)
    try {
      sessionStorage.setItem(LINKS_KEY, JSON.stringify(next))
    } catch {
      // Storage blocked: badges still expand this visit, and fall back to their labels after a reload.
    }
  }
  // The caret can only move once React has put the new text in the field; a frame later, typing may have moved on.
  const landing = useRef<number | null>(null)
  useLayoutEffect(() => {
    const to = landing.current
    if (to === null) return
    landing.current = null
    o.area.current?.setSelectionRange(to, to)
  })
  const change = (value: string, caret: number): void => {
    latest.current.value = value
    o.onChange(value)
    landing.current = caret
  }
  /**
   * A label no other badge in the prompt holds, so each token maps to one URL. Only two different links with the
   * same title get a counter; a link removed from the prompt holds nothing.
   */
  const free = (label: string, url: string): string => {
    const { links: all, value } = latest.current
    const taken = (name: string) => all[name] && all[name].url !== url && value.includes(token(name))
    let name = label
    for (let n = 2; taken(name); n++) name = `${cut(label, LABEL_MAX - 1 - String(n).length)} ${n}`
    return name
  }

  const retitle = (from: string, url: string, title: string, icon: string): void => {
    const label = free(cut(title), url)
    const { value, links: now } = latest.current
    setLinks({ ...now, [label]: { url, icon } })
    if (label === from) return
    const at = value.indexOf(token(from))
    if (at < 0) return
    const caret = o.area.current?.selectionStart ?? value.length
    const shift = caret > at ? token(label).length - token(from).length : 0
    change(value.replace(token(from), token(label)), caret + shift)
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): boolean => {
    const text = e.clipboardData.getData("text/plain").trim()
    if (!/^https?:\/\/\S+$/.test(text)) return false
    let url: URL
    try {
      url = new URL(text)
    } catch {
      return false
    }
    e.preventDefault()
    const el = e.currentTarget
    const { value } = latest.current
    const label = free(place(url), url.href)
    setLinks({ ...latest.current.links, [label]: { url: url.href, loading: true } })
    const piece = token(label)
    change(value.slice(0, el.selectionStart) + piece + value.slice(el.selectionEnd), el.selectionStart + piece.length)
    void o.model.client
      .request<{ title: string; icon: string }>("link.preview", { url: url.href })
      .catch(() => null)
      .then((res) => {
        retitle(label, url.href, res?.title || place(url), res?.icon ?? "")
      })
    return true
  }

  const caret = useRef(0)
  /** A caret never rests inside a badge: it hops to the far side, in the direction it was moving. */
  const onSelect = (e: { currentTarget: HTMLTextAreaElement }): void => {
    const el = e.currentTarget
    const { selectionStart: from, selectionEnd: to } = el
    let a = from
    let b = to
    for (const m of latest.current.value.matchAll(TOKEN)) {
      const start = m.index
      const end = start + m[0].length
      const forward = from === to ? from > caret.current : true
      if (a > start && a < end) a = from === to ? (forward ? end : start) : start
      if (b > start && b < end) b = from === to ? a : end
    }
    caret.current = a
    if (a !== from || b !== to) el.setSelectionRange(a, b)
  }

  /** Backspace or Delete next to a badge removes all of it. */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const el = e.currentTarget
    if ((e.key !== "Backspace" && e.key !== "Delete") || el.selectionStart !== el.selectionEnd) return false
    const { value } = latest.current
    const at = el.selectionStart
    for (const m of value.matchAll(TOKEN)) {
      const start = m.index
      const end = start + m[0].length
      const hit = e.key === "Backspace" ? at > start && at <= end : at >= start && at < end
      if (!hit) continue
      e.preventDefault()
      change(value.slice(0, start) + value.slice(end), start)
      return true
    }
    return false
  }

  const parts: ReactNode[] = []
  let last = 0
  for (const m of o.value.matchAll(TOKEN)) {
    const link = links[labelOf(m)]
    // The token's own characters, sliced where the pill starts and ends (HEAD and TAIL), MARKs and joiners too:
    // a font may give them width, and any difference drifts the text off the field's.
    const t = m[0]
    parts.push(o.value.slice(last, m.index), t.slice(0, 4))
    parts.push(
      <span key={m.index} className={link ? (link.loading ? L.LOADING : L.BADGE) : L.BROKEN}>
        {t.slice(4, 6)}
        <span className="relative">
          {t[6]}
          {link && <Favicon src={link.icon} />}
        </span>
        {t.slice(7, -3)}
      </span>,
      t.slice(-3),
    )
    last = m.index + m[0].length
  }
  parts.push(`${o.value.slice(last)}​`)

  return {
    /** The layer behind the field, which wears `FIELD` (ui/link-badge.ts) and spreads `field`. */
    layer: (
      <div ref={layer} aria-hidden className={L.LAYER}>
        {parts}
      </div>
    ),
    field: {
      ...o.field,
      onScroll: (e: { currentTarget: HTMLTextAreaElement }) => {
        if (layer.current) layer.current.scrollTop = e.currentTarget.scrollTop
      },
      onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => {
        o.onFilePaste?.(e)
        if (!e.defaultPrevented) onPaste(e)
      },
      onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => onKeyDown(e) || o.field.onKeyDown(e),
      onSelect: (e: { currentTarget: HTMLTextAreaElement }) => {
        onSelect(e)
        o.field.onSelect(e)
      },
    },
    /** Text at the caret (dictation), glued to the word before with a space; `focus` brings the keyboard up. */
    insert: (text: string, focus: boolean) => {
      const el = o.area.current
      const { value } = latest.current
      const at = el?.selectionStart ?? value.length
      const glue = at > 0 && !/\s$/.test(value.slice(0, at)) ? " " : ""
      if (focus) el?.focus()
      change(
        `${value.slice(0, at)}${glue}${text}${value.slice(el?.selectionEnd ?? value.length)}`,
        at + glue.length + text.length,
      )
    },
    expand: (text: string) => expandLinks(text, latest.current.links),
  }
}

/** The page's icon; a link glyph while it loads, or when the page has none. */
function Favicon({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <LinkGlyph />
  return <img src={src} alt="" draggable={false} onError={() => setFailed(true)} className={L.FAVICON} />
}

function LinkGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className={L.GLYPH}
    >
      <path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1a2.5 2.5 0 01-3.5-3.5l1-1" />
    </svg>
  )
}
