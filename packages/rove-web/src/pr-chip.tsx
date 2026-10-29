/** A rail row's PRs, after Claude's list: one icon (with a count past one) and, on hover or tap, every PR. */

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { TaskRow, TaskRowPr } from "rove-bridge/protocol"
import { t } from "./i18n/index.ts"
import { isTouch } from "./key-hints.ts"
import { type PrMark, leadPrMark, prMark, sessionPrMark } from "./rail-glyphs.ts"

interface Entry {
  readonly task: TaskRow
  readonly pr: TaskRowPr
  readonly mark: PrMark
}

/** `owner/repo` from a forge PR URL, or undefined for anything else. */
export function prRepo(url: string | undefined): string | undefined {
  const match = url?.match(/^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/(?:pull|merge_requests|-\/merge_requests)\//)
  return match?.[1]
}

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

function stateText(mark: PrMark): string {
  return [t(`rail.pr.state.${mark.state}`), ...(mark.checks ? [t(`rail.pr.checks.${mark.checks}`)] : [])].join(", ")
}

/**
 * One entry per PR, from each task's own branch PR and the PRs its session opened. A child sharing
 * its parent's directory sits on the same branch, so the same PR. Each task polls its own checks, so
 * a duplicate keeps whichever copy needs you most; a polled copy beats one still `unknown`.
 */
export function prEntries(tasks: readonly TaskRow[]): Entry[] {
  const byPr = new Map<string, Entry>()
  for (const task of tasks) {
    const own = prMark(task)
    const found = [
      ...(own && task.pr ? [{ pr: task.pr, mark: own }] : []),
      ...(task.sessionPrs ?? []).flatMap((pr) => {
        const mark = sessionPrMark(pr)
        return mark ? [{ pr, mark }] : []
      }),
    ]
    for (const { pr, mark } of found) {
      const key = pr.url ?? (pr.number !== undefined ? `${task.repo}#${pr.number}` : task.id)
      const kept = byPr.get(key)
      const unpolled = pr.lifecycle === "unknown"
      const keptUnpolled = kept?.pr.lifecycle === "unknown"
      if (
        !kept ||
        (keptUnpolled && !unpolled) ||
        (unpolled === keptUnpolled && leadPrMark([kept.mark, mark]) !== kept.mark)
      )
        byPr.set(key, { task, pr, mark })
    }
  }
  return [...byPr.values()]
}

/** `tasks`: the row's task, then its descendants; those without a PR draw nothing. `onOpen`: the list is opening. */
export function PrChip({ tasks, onOpen }: { tasks: readonly TaskRow[]; onOpen?: () => void }) {
  const [at, setAt] = useState<DOMRect | null>(null)
  const [closing, setClosing] = useState(false)
  const chip = useRef<HTMLSpanElement>(null)
  const leave = useRef<number | null>(null)
  const list = useRef<HTMLDivElement>(null)
  // A touch screen has no hover: a tap toggles the list and a tap anywhere else closes it.
  const coarse = isTouch()
  // A row low in the rail opens its list upward far enough to stay on screen; one at the right
  // edge (a phone's full-width rail) drops below the chip, inside the screen.
  useLayoutEffect(() => {
    const el = list.current
    if (!el || !at) return
    const box = el.getBoundingClientRect()
    if (box.right > window.innerWidth - 8) {
      el.style.left = `${Math.max(8, window.innerWidth - box.width - 8)}px`
      el.style.top = `${at.bottom + 6}px`
    }
    const overflow = el.getBoundingClientRect().bottom - (window.innerHeight - 8)
    if (overflow > 0) el.style.top = `${Math.max(8, el.getBoundingClientRect().top - overflow)}px`
  }, [at])
  const show = () => {
    onOpen?.()
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
  useEffect(() => {
    if (!coarse || !at) return
    const away = (e: PointerEvent) => {
      const target = e.target as Node
      if (chip.current?.contains(target) || list.current?.contains(target)) return
      setClosing(true)
      leave.current = window.setTimeout(() => setAt(null), 140)
    }
    document.addEventListener("pointerdown", away, true)
    return () => document.removeEventListener("pointerdown", away, true)
  }, [coarse, at])
  useEffect(
    () => () => {
      if (leave.current !== null) window.clearTimeout(leave.current)
    },
    [],
  )
  const entries = prEntries(tasks)
  const lead = leadPrMark(entries.map((entry) => entry.mark))
  if (!lead) return null
  const label =
    entries.length === 1
      ? `PR #${entries[0]?.pr.number ?? ""}, ${stateText(lead)}`
      : t("rail.pr.many", { count: entries.length })
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the tap is touch-only; keys go to the row's button
    <span
      ref={chip}
      className={`chip pr-chip ${lead.tone}`}
      aria-label={label}
      onMouseEnter={coarse ? undefined : show}
      onMouseLeave={coarse ? undefined : hide}
      onClick={(e) => {
        if (!coarse) return
        // The tap belongs to the chip, not the row underneath.
        e.stopPropagation()
        if (at && !closing) hide()
        else show()
      }}
    >
      {lead.glyph}
      {entries.length > 1 && <span className="pr-chip-count">{entries.length}</span>}
      {at &&
        createPortal(
          // Events still bubble through the portal to the row's button; the list keeps them.
          <div
            ref={list}
            className={`pr-list ${closing ? "is-closing" : ""}`}
            style={{ top: at.top - 6, left: at.right + 8 }}
            onMouseEnter={coarse ? undefined : show}
            onMouseLeave={coarse ? undefined : hide}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            {entries.map(({ task, pr, mark }) => {
              const repo = prRepo(pr?.url)
              const stats = pr?.additions !== undefined && pr.deletions !== undefined
              return (
                <button
                  key={pr.url ?? `${task.id}#${pr.number ?? ""}`}
                  type="button"
                  className="pr-list-item"
                  disabled={!pr?.url}
                  onClick={() => pr?.url && window.open(pr.url, "_blank", "noopener")}
                >
                  <span className="pr-list-title">{pr.title || task.title}</span>
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
                        .map((part) => `, ${part}`)
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
