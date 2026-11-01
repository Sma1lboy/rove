/**
 * The Search page: what was said in any task's conversations (`sessions.search` → `rove api search`),
 * newest session first. A hit opens its task; the terminal cannot scroll to the line, so the row
 * shows the words around it instead.
 */

import { useEffect, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { compactAge } from "./inbox.ts"
import type { AppModel } from "./model.ts"
import { usePageKeys } from "./pages-kit.ts"
import { page } from "./ui.ts"
import { PAGE_SCROLL, PAGE_TITLE, PG_LIST, PG_NOTICE } from "./ui/page.ts"
import * as s from "./ui/search.ts"
import { INPUT } from "./ui/text.ts"

interface Hit {
  readonly taskId: string
  readonly title: string
  readonly tabId?: string
  readonly role: "user" | "assistant"
  readonly at: string
  readonly snippet: string
}

interface Reply {
  readonly matches: readonly Hit[]
  readonly skipped: readonly unknown[]
  readonly truncated: boolean
}

const MIN_CHARS = 2
const DEBOUNCE_MS = 300

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "done"; readonly query: string; readonly reply: Reply }
  | { readonly kind: "failed"; readonly message: string }

/** `text` with each case-insensitive `needle` wrapped in a mark. */
function marked(text: string, needle: string) {
  const parts: (string | { readonly hit: string; readonly at: number })[] = []
  const lower = text.toLowerCase()
  const n = needle.toLowerCase()
  let from = 0
  for (let at = lower.indexOf(n); n && at >= 0; at = lower.indexOf(n, at + n.length)) {
    parts.push(text.slice(from, at), { hit: text.slice(at, at + n.length), at })
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

export function SearchView({ model }: { model: AppModel }) {
  useLocale()
  const [query, setQuery] = useState("")
  const [state, setState] = useState<State>({ kind: "idle" })
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_CHARS) {
      setState({ kind: "idle" })
      return
    }
    let live = true
    const timer = window.setTimeout(() => {
      setState({ kind: "searching" })
      model.client.request<Reply>("sessions.search", { query: q }).then(
        (reply) => {
          if (!live) return
          setState({ kind: "done", query: q, reply })
          setCursor(0)
        },
        (err: unknown) =>
          live && setState({ kind: "failed", message: err instanceof Error ? err.message : String(err) }),
      )
    }, DEBOUNCE_MS)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [model, query])

  const hits = state.kind === "done" ? state.reply.matches : []
  const open = (hit: Hit) => model.select(hit.taskId, hit.tabId ?? null)
  usePageKeys((e) => {
    if (e.key === "Escape" || e.key === "q") page.set(null)
    else if (e.key === "ArrowDown" || e.key === "j") setCursor((c) => Math.min(hits.length - 1, c + 1))
    else if (e.key === "ArrowUp" || e.key === "k") setCursor((c) => Math.max(0, c - 1))
    else if (e.key === "Enter" && hits[cursor]) open(hits[cursor])
    else return false
    return true
  })

  return (
    <section className={PAGE_SCROLL}>
      <h2 className={PAGE_TITLE}>{t("search.title")}</h2>
      <input
        className={`${INPUT} ${s.SEARCH_FIELD}`}
        type="search"
        // biome-ignore lint/a11y/noAutofocus: the page's only field
        autoFocus
        spellCheck={false}
        value={query}
        placeholder={t("search.placeholder")}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setCursor((c) => Math.min(hits.length - 1, c + 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setCursor((c) => Math.max(0, c - 1))
          } else if (e.key === "Enter" && hits[cursor]) {
            e.preventDefault()
            open(hits[cursor])
          } else if (e.key === "Escape") page.set(null)
        }}
      />
      {state.kind === "idle" && <p className={`${PG_NOTICE} text-muted`}>{t("search.hint")}</p>}
      {state.kind === "searching" && <p className={`${PG_NOTICE} text-muted`}>{t("search.searching")}</p>}
      {state.kind === "failed" && <p className={`${PG_NOTICE} text-error`}>{state.message}</p>}
      {state.kind === "done" && hits.length === 0 && (
        <p className={`${PG_NOTICE} text-muted`}>{t("search.none", { query: state.query })}</p>
      )}
      {hits.length > 0 && (
        <div className={PG_LIST}>
          {hits.map((hit, i) => (
            <button
              type="button"
              key={`${hit.taskId}:${hit.at}:${i}`}
              className={s.searchHitClass(i === cursor)}
              onMouseEnter={() => setCursor(i)}
              onClick={() => open(hit)}
            >
              <span className={s.SEARCH_HIT_HEAD}>
                <span className={s.SEARCH_HIT_TITLE}>{hit.title}</span>
                <span className={s.SEARCH_HIT_META}>
                  {t(hit.role === "user" ? "search.you" : "search.agent")} ·{" "}
                  {compactAge(Date.now() - Date.parse(hit.at))}
                </span>
              </span>
              <span className={s.SEARCH_SNIPPET}>{marked(hit.snippet, state.kind === "done" ? state.query : "")}</span>
            </button>
          ))}
        </div>
      )}
      {state.kind === "done" && state.reply.truncated && (
        <p className={`${PG_NOTICE} text-muted`}>{t("search.truncated")}</p>
      )}
      {state.kind === "done" && state.reply.skipped.length > 0 && (
        <p className={`${PG_NOTICE} text-muted`}>{t("search.skipped", { count: state.reply.skipped.length })}</p>
      )}
    </section>
  )
}
