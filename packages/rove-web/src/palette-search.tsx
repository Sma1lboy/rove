/** What the command palette adds to its commands: tasks by title (the rail's match) and what was said in any conversation. */

import { useEffect, useState } from "react"
import { t } from "./i18n/index.ts"
import { compactAge } from "./inbox.ts"
import type { AppModel } from "./model.ts"
import { type Hit, type HitState, type Reply, hitSearch } from "./search-hits.ts"
import { Button } from "./ui/button.tsx"
import * as s from "./ui/search.ts"

/** Conversation hits for `query`; a reply for an older query never lands. */
export function useConversationHits(model: AppModel, query: string): HitState {
  const [state, setState] = useState<HitState>({ kind: "idle" })
  useEffect(() => {
    const search = hitSearch((q) => model.client.request<Reply>("sessions.search", { query: q }), setState)
    search.run(query)
    return search.stop
  }, [model, query])
  return state
}

/** `text` with each case-insensitive `needle` wrapped in a mark. */
function marked(text: string, needle: string) {
  const parts: (string | { readonly hit: string; readonly at: number })[] = []
  const lower = text.toLowerCase()
  const n = needle.toLowerCase()
  let from = 0
  for (let at = lower.indexOf(n); n && at >= 0; at = lower.indexOf(n, at + n.length)) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push({ hit: text.slice(at, at + n.length), at })
    from = at + n.length
  }
  parts.push(text.slice(from))
  return parts.map((p) =>
    typeof p === "string" ? (
      p
    ) : (
      <mark key={p.at} className={s.SEARCH_MARK}>
        {p.hit}
      </mark>
    ),
  )
}

export function SectionHead({ children }: { children: string }) {
  return <h3 className={s.SEARCH_HEAD}>{children}</h3>
}

export function Note({ children, error }: { children: string; error?: boolean }) {
  return <p className={`${s.SEARCH_NOTE} ${error ? "text-error" : ""}`}>{children}</p>
}

export function TaskEntry(props: {
  title: string
  repo: string
  selected: boolean
  onHover: () => void
  onOpen: () => void
}) {
  return (
    <Button
      variant="row"
      className={s.searchRowClass(props.selected)}
      onMouseEnter={props.onHover}
      onClick={props.onOpen}
    >
      <span className={s.SEARCH_ROW_HEAD}>
        <span className={s.SEARCH_ROW_TITLE}>{props.title}</span>
        <span className={s.SEARCH_ROW_META}>{props.repo}</span>
      </span>
    </Button>
  )
}

export function HitEntry(props: {
  hit: Hit
  query: string
  selected: boolean
  onHover: () => void
  onOpen: () => void
}) {
  const { hit } = props
  return (
    <Button
      variant="row"
      className={s.searchRowClass(props.selected)}
      onMouseEnter={props.onHover}
      onClick={props.onOpen}
    >
      <span className={s.SEARCH_ROW_HEAD}>
        <span className={s.SEARCH_ROW_TITLE}>{hit.title}</span>
        <span className={s.SEARCH_ROW_META}>
          {t(hit.role === "user" ? "search.you" : "search.agent")} · {compactAge(Date.now() - Date.parse(hit.at))}
        </span>
      </span>
      <span className={s.SEARCH_SNIPPET}>{marked(hit.snippet, props.query)}</span>
    </Button>
  )
}
