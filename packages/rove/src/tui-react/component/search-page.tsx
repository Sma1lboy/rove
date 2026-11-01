/** @jsxImportSource @opentui/react */
/**
 * The rail's Search page: what you and the agents wrote in any task's conversation, newest session first
 * (`engine/session-search.ts`, the same search as `rove api search` and the web's Search page). Enter opens
 * the hit's task on its tab; the terminal does not scroll to the line, so each row shows the words around it.
 */

import { useEffect, useRef, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { type SearchResult, searchTasks } from "../../engine/session-search"
import { relativeAge } from "../../lib/relative-time"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { useTerminalSize } from "../lib/use-terminal-size"

const MIN_CHARS = 2
const DEBOUNCE_MS = 300
const LIMIT = 30

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "done"; readonly result: SearchResult }
  | { readonly kind: "failed"; readonly reason: string }

export interface SearchPageProps {
  readonly orchestrator: RemoteOrchestrator
  readonly focused: boolean
  readonly onClose: () => void
  readonly onOpenTask: (taskId: string, tabId?: string) => void
  /** Wait after the last keystroke before searching. */
  readonly debounceMs?: number
}

export function SearchPage(props: SearchPageProps) {
  const { theme } = useTheme()
  const t = useT()
  const dimensions = useTerminalSize()
  const [query, setQuery] = useState("")
  const [state, setState] = useState<State>({ kind: "idle" })
  const [cursor, setCursor] = useState(0)
  // A slower search for an older query must not replace a newer one's answer.
  const seq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    const mine = ++seq.current
    if (q.length < MIN_CHARS) {
      setState({ kind: "idle" })
      return
    }
    const timer = setTimeout(() => {
      setState({ kind: "searching" })
      searchTasks(props.orchestrator.listTasks(), q, LIMIT).then(
        (result) => {
          if (mine !== seq.current) return
          setState({ kind: "done", result })
          setCursor(0)
        },
        (err: unknown) => {
          if (mine === seq.current)
            setState({ kind: "failed", reason: err instanceof Error ? err.message : String(err) })
        },
      )
    }, props.debounceMs ?? DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, props.orchestrator, props.debounceMs])

  const hits = state.kind === "done" ? state.result.matches : []
  const index = Math.min(cursor, Math.max(0, hits.length - 1))
  const open = (i: number) => {
    const hit = hits[i]
    if (hit) props.onOpenTask(hit.taskId, hit.tabId)
  }
  useBindings(() => ({
    enabled: props.focused,
    bindings: [
      // The field takes every other key, `q` included: only Esc leaves a page with a text field.
      { key: "escape", cmd: props.onClose },
      { key: "up", cmd: () => setCursor(Math.max(0, index - 1)) },
      { key: "down", cmd: () => setCursor(Math.min(hits.length - 1, index + 1)) },
      { key: "return", cmd: () => open(index) },
    ],
  }))

  // Two lines a hit; the field, the hint and the footer take the rest.
  const visible = Math.max(1, Math.floor((dimensions.height - 9) / 2))
  const start = Math.max(0, index - visible + 1)
  const now = Date.now()
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1} gap={1}>
      <text fg={theme.accent}>{t("search.title")}</text>
      <input
        focused={props.focused}
        value={query}
        placeholder={t("search.placeholder")}
        onInput={(value: string) => setQuery(value)}
      />
      <box flexDirection="column" flexGrow={1}>
        {state.kind === "idle" && <text fg={theme.textMuted}>{t("search.hint")}</text>}
        {state.kind === "searching" && <text fg={theme.textMuted}>{t("search.searching")}</text>}
        {state.kind === "failed" && <text fg={theme.error}>{t("search.failed", { reason: state.reason })}</text>}
        {state.kind === "done" && hits.length === 0 && (
          <text fg={theme.textMuted}>{t("search.none", { query: state.result.query })}</text>
        )}
        {hits.slice(start, start + visible).map((hit, offset) => {
          const at = start + offset
          const picked = at === index
          return (
            <box
              key={`${hit.taskId}:${hit.at}:${at}`}
              flexDirection="column"
              backgroundColor={picked ? theme.backgroundElement : undefined}
              onMouseUp={() => open(at)}
            >
              <box flexDirection="row" gap={2}>
                <text fg={theme.text} flexGrow={1} flexBasis={0} flexShrink={1}>
                  {`${picked ? "› " : "  "}${hit.title}`}
                </text>
                <text fg={theme.textMuted} flexShrink={0}>
                  {`${t(hit.role === "user" ? "search.you" : "search.agent")} · ${relativeAge(Date.parse(hit.at), now)}`}
                </text>
              </box>
              <text fg={theme.textMuted}>{`  ${hit.snippet}`}</text>
            </box>
          )
        })}
      </box>
      {state.kind === "done" && state.result.truncated && <text fg={theme.textMuted}>{t("search.truncated")}</text>}
      {state.kind === "done" && state.result.skipped.length > 0 && (
        <text fg={theme.textMuted}>{t("search.skipped", { count: state.result.skipped.length })}</text>
      )}
      <text fg={theme.textMuted}>{t("search.keys")}</text>
    </box>
  )
}
