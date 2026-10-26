/** A rail row's PRs, after Claude's list: one icon (with a count past one) and, on hover, every PR. */

import { useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { TaskRow } from "rove-bridge/protocol"
import { t } from "./i18n/index.ts"
import { type PrMark, leadPrMark, prMark } from "./rail-glyphs.ts"

interface Entry {
  readonly task: TaskRow
  readonly mark: PrMark
}

/** `owner/repo` from a forge PR URL, or undefined for anything else. */
export function prRepo(url: string | undefined): string | undefined {
  const match = url?.match(/^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/(?:pull|merge_requests|-\/merge_requests)\//)
  return match?.[1]
}

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

function stateText(mark: PrMark): string {
  return [t(`rail.pr.state.${mark.state}`), ...(mark.checks ? [t(`rail.pr.checks.${mark.checks}`)] : [])].join(" · ")
}

/** One entry per PR: a child sharing its parent's directory sits on the same branch, so the same PR. */
export function prEntries(tasks: readonly TaskRow[]): Entry[] {
  const seen = new Set<string>()
  return tasks.flatMap((task) => {
    const mark = prMark(task)
    const key = task.pr?.url ?? (task.pr ? `${task.repo}#${task.pr.number}` : task.id)
    if (!mark || seen.has(key)) return []
    seen.add(key)
    return [{ task, mark }]
  })
}

/** `tasks`: the row's task, then its descendants; those without a PR draw nothing. */
export function PrChip({ tasks }: { tasks: readonly TaskRow[] }) {
  const [at, setAt] = useState<DOMRect | null>(null)
  const [closing, setClosing] = useState(false)
  const chip = useRef<HTMLSpanElement>(null)
  const leave = useRef<number | null>(null)
  const list = useRef<HTMLDivElement>(null)
  // A row low in the rail opens its list upward far enough to stay on screen.
  useLayoutEffect(() => {
    const el = list.current
    if (!el || !at) return
    const overflow = el.getBoundingClientRect().bottom - (window.innerHeight - 8)
    if (overflow > 0) el.style.top = `${Math.max(8, at.top - 6 - overflow)}px`
  }, [at])
  const entries = prEntries(tasks)
  const lead = leadPrMark(entries.map((entry) => entry.mark))
  if (!lead) return null
  const show = () => {
    if (leave.current !== null) window.clearTimeout(leave.current)
    leave.current = null
    setClosing(false)
    if (chip.current && !at) setAt(chip.current.getBoundingClientRect())
  }
  // The fade out doubles as the grace that lets the pointer cross from the chip into the list.
  const hide = () => {
    setClosing(true)
    leave.current = window.setTimeout(() => setAt(null), 140)
  }
  const label =
    entries.length === 1
      ? `PR #${entries[0]?.task.pr?.number ?? ""} · ${stateText(lead)}`
      : t("rail.pr.many", { count: entries.length })
  return (
    <span ref={chip} className={`chip pr-chip ${lead.tone}`} aria-label={label} onMouseEnter={show} onMouseLeave={hide}>
      {lead.glyph}
      {entries.length > 1 && <span className="pr-chip-count">{entries.length}</span>}
      {at &&
        createPortal(
          // Events still bubble through the portal to the row's button; the list keeps them.
          <div
            ref={list}
            className={`pr-list ${closing ? "is-closing" : ""}`}
            style={{ top: at.top - 6, left: at.right + 8 }}
            onMouseEnter={show}
            onMouseLeave={hide}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            {entries.map(({ task, mark }) => {
              const pr = task.pr
              const repo = prRepo(pr?.url)
              const stats = pr?.additions !== undefined && pr.deletions !== undefined
              return (
                <button
                  key={task.id}
                  type="button"
                  className="pr-list-item"
                  disabled={!pr?.url}
                  onClick={() => pr?.url && window.open(pr.url, "_blank", "noopener")}
                >
                  <span className="pr-list-title">{pr?.title || task.title}</span>
                  <span className="pr-list-line">
                    <span className={`pr-list-state ${mark.tone}`}>
                      <span className="pr-list-glyph">{mark.glyph}</span>
                      {capitalize(t(`rail.pr.state.${mark.state}`))}
                    </span>
                    <span className="pr-list-meta">
                      {[
                        ...(mark.checks ? [t(`rail.pr.checks.${mark.checks}`)] : []),
                        [repo, pr?.number !== undefined ? `#${pr.number}` : ""].filter(Boolean).join(" "),
                      ]
                        .filter(Boolean)
                        .map((part) => ` · ${part}`)
                        .join("")}
                    </span>
                    {stats && (
                      <span className="pr-list-stats">
                        <span className="tone-success">+{pr.additions}</span>
                        <span className="tone-attention">−{pr.deletions}</span>
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </span>
  )
}
