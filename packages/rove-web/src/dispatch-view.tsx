/**
 * The Dispatch page: every prompt one session handed another, as the daemon's dispatch ledger
 * publishes it. An in-flight row is a lane a courier runs from sender to target, then works,
 * asks or knocks there; settled rows drop to a one-line history. Click a row to open its target.
 */

import "./dispatch.css"
import { useEffect, useState } from "react"
import type { DispatchRow, TaskRow } from "rove-bridge/protocol"
import { FRAME_MS, lanes, moving, runnerOf } from "./dispatch.ts"
import { t, useLocale } from "./i18n/index.ts"
import { compactAge } from "./inbox.ts"
import type { AppModel } from "./model.ts"
import { usePageFocus, usePageKeys } from "./pages-kit.ts"
import { useStore } from "./store.ts"
import { page } from "./ui.ts"

const STATUS_GLYPH: Record<DispatchRow["status"], string> = {
  delivered: "→",
  working: "●",
  asking: "?",
  done: "✓",
  failed: "✗",
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Ticks while a courier moves; a reduced-motion viewer gets each pose's first frame and no travel. */
function useClock(active: boolean): { now: number; frame: number } {
  const [clock, setClock] = useState(() => ({ now: Date.now(), frame: 0 }))
  useEffect(() => {
    if (!active || reducedMotion()) return
    const timer = window.setInterval(() => setClock((c) => ({ now: Date.now(), frame: c.frame + 1 })), FRAME_MS)
    return () => window.clearInterval(timer)
  }, [active])
  return active && !reducedMotion() ? clock : { now: Number.POSITIVE_INFINITY, frame: 0 }
}

export function DispatchView({ model }: { model: AppModel }) {
  useLocale()
  const root = usePageFocus()
  const snapshot = useStore(model.dispatches)
  const payload = useStore(model.tasks)
  const rows = snapshot?.rows ?? []
  const { open, done } = lanes(rows)
  const { now, frame } = useClock(moving(open))
  const tasks = new Map((payload?.tasks ?? []).map((task) => [task.id, task]))

  usePageKeys((e) => {
    if (e.key === "Escape" || e.key === "q" || (e.ctrlKey && e.key === "c")) {
      page.set(null)
      return true
    }
    return false
  })

  const name = (end: DispatchRow["to"] | null, row: DispatchRow) => {
    if (!end) return row.routine ? `⟳ ${row.routine}` : t("dispatch.you")
    return endLabel(tasks.get(end.taskId), end)
  }
  const openTarget = (row: DispatchRow) => model.select(row.to.taskId, row.to.tabId)

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className="page dp-page" tabIndex={0} ref={root}>
      <div className="pg-top">
        <h1 className="page-title">{t("dispatch.title")}</h1>
        <span className="muted mono pg-hint">{t("dispatch.hint")}</span>
      </div>
      {snapshot === null ? null : open.length === 0 && done.length === 0 ? (
        <div className="dp-empty">
          <pre className="dp-sprite" aria-hidden="true">
            {runnerOf(IDLE, 0, 0).sprite.join("\n")}
          </pre>
          <p>{t("dispatch.empty")}</p>
          <p className="muted">{t("dispatch.emptyHint")}</p>
        </div>
      ) : null}
      {open.length > 0 ? (
        <section className="dp-section">
          <h2 className="kicker">{t("dispatch.inFlight")}</h2>
          {open.map((row) => {
            const runner = runnerOf(row, now, frame)
            return (
              <button
                type="button"
                key={row.id}
                className="dp-lane"
                onClick={() => openTarget(row)}
                title={row.promptHead}
              >
                <span className="dp-end mono">{name(row.from, row)}</span>
                <span className="dp-track" aria-hidden="true">
                  <span className="dp-rail" style={{ transform: `translateX(${runner.x * 100}%)` }}>
                    <pre className={`dp-sprite is-${runner.pose}`}>{runner.sprite.join("\n")}</pre>
                  </span>
                </span>
                <span className="dp-end mono">{name(row.to, row)}</span>
                <span className={`dp-status mono is-${row.status}`}>
                  {STATUS_GLYPH[row.status]} {t(`dispatch.status.${row.status}`)}
                </span>
                <span className="dp-prompt muted">{row.promptHead}</span>
              </button>
            )
          })}
        </section>
      ) : null}
      {done.length > 0 ? (
        <section className="dp-section">
          <h2 className="kicker">{t("dispatch.recent")}</h2>
          {done.map((row) => (
            <button
              type="button"
              key={row.id}
              className="dp-past"
              onClick={() => openTarget(row)}
              title={row.promptHead}
            >
              <span className={`dp-status mono is-${row.status}`}>{STATUS_GLYPH[row.status]}</span>
              <span className="dp-route mono">
                {name(row.from, row)} → {name(row.to, row)}
              </span>
              <span className="dp-prompt muted">
                {row.status === "failed" && row.reason ? `${row.reason} · ` : ""}
                {row.promptHead}
              </span>
              <span className="muted mono dp-age">{compactAge(Date.now() - row.statusAt)}</span>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  )
}

const IDLE: DispatchRow = {
  id: "idle",
  kind: "send",
  from: null,
  to: { taskId: "", tabId: null },
  promptHead: "",
  at: 0,
  status: "done",
  statusAt: 0,
}

function endLabel(task: TaskRow | undefined, end: DispatchRow["to"]): string {
  const title = task?.title || end.taskId
  return end.tabId && end.tabId !== "tab-1" ? `${title} · ${end.tabId}` : title
}
