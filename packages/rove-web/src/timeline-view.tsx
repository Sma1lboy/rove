/** The Files pane's Activity tab: what happened in this task, newest first, one line each; a click goes where the row happened. */

import { useEffect, useRef, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { openDiff } from "./panel-state.ts"
import { createStore, useStore } from "./store.ts"
import { KIND_LOOK, LOOK_OTHER, type TimelineRow, jumpOf, mergeRows, prChanges } from "./timeline.ts"
import { GLYPH, ROW_TITLE, rowClass } from "./ui/row.ts"
import { PLACEHOLDER_LINE } from "./ui/text.ts"

/** PR changes this page has seen per task: the feed carries the PR's state, not its history. */
const seenPr = createStore<Readonly<Record<string, readonly TimelineRow[]>>>({})
/** Enough for a long run; the oldest go first. */
const SEEN_CAP = 50
/** A read this soon after the last one waits for it, so a burst of feed pushes is one request. */
const REFRESH_MS = 400
/** Commits land without a feed push of their own: poll while the tab is on screen. */
const POLL_MS = 15_000

const clock = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })

/** Record a PR change the feed just showed; call with each new `task` of the one on screen. */
function notePr(prev: TaskRow | undefined, task: TaskRow): void {
  if (!prev || prev.id !== task.id) return
  const kinds = prChanges(prev.pr, task.pr)
  if (kinds.length === 0) return
  const at = Date.now()
  const rows = kinds.map((kind) => ({
    kind,
    at,
    tail: task.pr?.number === undefined ? "" : `#${task.pr.number}`,
    ...(task.pr?.url ? { url: task.pr.url } : {}),
  }))
  const all = seenPr.get()
  seenPr.set({ ...all, [task.id]: [...(all[task.id] ?? []), ...rows].slice(-SEEN_CAP) })
}

/** Keeps the page's record of PR changes while the Files pane is open, whichever of its tabs shows. */
export function useTrackPr(task: TaskRow): void {
  const last = useRef<TaskRow | undefined>(undefined)
  useEffect(() => {
    notePr(last.current, task)
    last.current = task
  }, [task])
}

export function TimelineView({ model, task }: { model: AppModel; task: TaskRow }) {
  useLocale()
  const [served, setServed] = useState<readonly TimelineRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seen = useStore(seenPr)[task.id]
  // What moves when the task does something worth a row: its status, its changes, its PR, its tabs.
  const stamp = JSON.stringify([task.rowStatus, task.tabStatus, task.changes, task.pr, task.updatedAt])
  const at = useRef(0)
  const read = useRef<() => void>(() => {})
  read.current = () => {
    at.current = Date.now()
    model.client.request<{ entries: TimelineRow[] }>("task.timeline", { taskId: task.id }).then(
      (res) => {
        setServed(res.entries)
        setError(null)
      },
      (err) => setError(err instanceof Error ? err.message : String(err)),
    )
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: stamp is the refetch trigger.
  useEffect(() => {
    const soon = window.setTimeout(() => read.current(), Math.max(0, at.current + REFRESH_MS - Date.now()))
    return () => window.clearTimeout(soon)
  }, [stamp])
  useEffect(() => {
    const id = window.setInterval(() => read.current(), POLL_MS)
    return () => window.clearInterval(id)
  }, [])
  const rows = mergeRows(served ?? [], seen ?? [])
  const go = (row: TimelineRow) => {
    const jump = jumpOf(row)
    if (jump?.to === "tab") model.select(task.id, jump.tabId)
    else if (jump?.to === "diff") openDiff({ taskId: task.id, path: ".", scope: "branch" })
    else if (jump?.to === "pr") window.open(jump.url, "_blank", "noopener")
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {error && <p className="mono text-error">{error}</p>}
      {!error && served !== null && rows.length === 0 && <p className={PLACEHOLDER_LINE}>{t("files.activityEmpty")}</p>}
      {rows.map((row) => {
        const look = KIND_LOOK[row.kind] ?? LOOK_OTHER
        const label = row.kind in KIND_LOOK ? t(`files.activityKind.${row.kind}`) : row.kind
        const jump = jumpOf(row)
        return (
          <button
            type="button"
            key={`${row.at}:${row.kind}:${row.tabId ?? ""}:${row.sha ?? ""}:${row.tail}`}
            className={rowClass({ size: "file" })}
            disabled={!jump}
            title={row.tail ? `${label} · ${row.tail}` : label}
            onClick={() => go(row)}
          >
            <span className="flex-none text-muted tabular-nums">{clock(row.at)}</span>
            <span className={`${GLYPH} ${look.tone}`}>{look.glyph}</span>
            <span className={ROW_TITLE}>
              {label}
              {row.tail && <span className="text-muted"> {row.tail}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
