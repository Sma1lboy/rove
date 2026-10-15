/**
 * The Routines page (TUI `automations-page.tsx`): the daemon's scheduled routines as a list with the
 * selected one's prompt, recent runs and the agent's responses beneath. j/k or arrows move, `n`
 * composes a routine, and on the cursor row `e` pauses or resumes, `s` (or the Run now button) runs
 * it now, `d` deletes after a confirm, Enter opens the latest run's task, `r` refetches, q/Esc close.
 * Prechecks, grace windows and standing-session mode stay CLI-only (`rove api routine-update`).
 */

import {
  type Automation,
  type AutomationRun,
  type AutomationRunStatus,
  automationRunNeedsAttention,
  routineRunResponseState,
} from "@sma1lboy/rove/src/tui/component/automation-run-core.ts"
import { useEffect, useRef, useState } from "react"
import { ConfirmDialog } from "./dialogs.tsx"
import type { AppModel } from "./model.ts"
import {
  errorMessage,
  fill,
  mergeRepos,
  projectLabel,
  useCopy,
  usePageFocus,
  usePageKeys,
  useReload,
  useSelectedRepo,
  useTaskRepos,
} from "./pages-kit.ts"
import { RoutineComposer } from "./routine-composer.tsx"
import { useStore } from "./store.ts"
import { dialog, page, toast } from "./ui.ts"

const POLL_MS = 5_000
/** How many runs the history lists (the TUI's `runs.slice(0, 5)`). */
const RUNS_SHOWN = 5

interface RoutinesReply {
  readonly automations: readonly Automation[]
  readonly keepsDaemonAlive: boolean
  readonly lastRunStatus?: Readonly<Record<string, AutomationRunStatus>>
}

/** Run-status → glance tone. `skipped_precheck` is healthy, `dispatch_failed` wants a human. */
const RUN_TONE: Record<string, "success" | "muted" | "warning" | "error"> = {
  dispatched: "success",
  revived: "success",
  skipped_precheck: "muted",
  skipped_cancelled: "muted",
  skipped_missed: "warning",
  skipped_unavailable: "warning",
  dispatch_failed: "error",
}
const TONE_CLASS = {
  success: "tone-success",
  muted: "muted",
  warning: "tone-warning",
  error: "tone-attention",
} as const
const TONE_GLYPH = { success: "✓", error: "†", warning: "!", muted: "·" } as const

const runTone = (status: string) => RUN_TONE[status] ?? "muted"

export function RoutinesView({ model }: { model: AppModel }) {
  const { auto, common } = useCopy()
  const c = model.client
  const [tick, reload] = useReload(POLL_MS)
  const payload = useStore(model.tasks)
  const taskRepos = useTaskRepos(model)
  const focusRepo = useSelectedRepo(model)
  const [reply, setReply] = useState<RoutinesReply | null>(null)
  const [runs, setRuns] = useState<readonly AutomationRun[]>([])
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const root = usePageFocus()

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a trigger the body doesn't read
  useEffect(() => {
    let live = true
    c.request<RoutinesReply>("routine.list")
      .then((res) => live && setReply(res))
      // Stale rows beat none until the next poll succeeds.
      .catch(() => live && setReply((prev) => prev ?? { automations: [], keepsDaemonAlive: false }))
    return () => {
      live = false
    }
  }, [c, tick])

  const rows = reply?.automations ?? []
  const lastRunStatus = reply?.lastRunStatus ?? {}
  const at = Math.min(cursor, Math.max(0, rows.length - 1))
  const selected = rows[at]
  const needAttention = rows.filter((a) => {
    const status = lastRunStatus[a.id]
    return status !== undefined && automationRunNeedsAttention(status)
  }).length

  // Run history follows the cursor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a trigger
  useEffect(() => {
    let live = true
    if (!selected) {
      setRuns([])
      return
    }
    c.request<{ runs: AutomationRun[] }>("routine.runs", { id: selected.id })
      .then((res) => live && setRuns(res.runs))
      .catch(() => live && setRuns([]))
    return () => {
      live = false
    }
  }, [c, selected?.id, tick])

  // A notice names ONE routine: clear it when the selection moves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id is the trigger
  useEffect(() => setNotice(null), [selected?.id])
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: "nearest" })
  }, [at])

  const now = Date.now()
  const when = (iso: string | undefined) => {
    const time = iso ? Date.parse(iso) : Number.NaN
    if (!Number.isFinite(time)) return "—"
    const delta = time - now
    const ahead = delta >= 0
    const minutes = Math.floor(Math.abs(delta) / 60_000)
    const hours = Math.floor(minutes / 60)
    if (minutes < 1) return ahead ? auto.when.now : auto.when.justNow
    if (minutes < 60) return fill(ahead ? auto.when.inMinutes : auto.when.minutesAgo, { n: minutes })
    if (hours < 24) return fill(ahead ? auto.when.inHours : auto.when.hoursAgo, { n: hours })
    return new Date(time).toLocaleDateString()
  }
  const statusText = (status: string) => (auto.runStatus as Record<string, string>)[status] ?? status
  const titleOf = (taskId: string) => payload?.tasks.find((task) => task.id === taskId)?.title ?? taskId

  const fail = (template: string, name: string, err: unknown) =>
    toast(fill(template, { name, error: errorMessage(err) }), "error")

  const toggleEnabled = async () => {
    if (!selected || busy) return
    setBusy(selected.id)
    try {
      await c.request("routine.setEnabled", { id: selected.id, enabled: !selected.enabled })
      reload()
    } catch (err) {
      // An unchanged routine: name the state it had BEFORE, not the one requested.
      fail(selected.enabled ? auto.disableFailed : auto.enableFailed, selected.name, err)
    } finally {
      setBusy(null)
    }
  }

  const runNow = async () => {
    if (!selected || busy) return
    setBusy(selected.id)
    setNotice(fill(auto.running, { name: selected.name }))
    try {
      const res = await c.request<{ status: string }>("routine.runNow", { id: selected.id })
      setNotice(fill(auto.ranWith, { name: selected.name, status: res.status }))
      reload()
    } catch (err) {
      fail(auto.runFailed, selected.name, err)
    } finally {
      setBusy(null)
    }
  }

  const createRoutine = async () => {
    if (busy) return
    // Saved projects union task repos, the New-task dialog's set.
    const saved = await c
      .request<{ repos: string[] }>("repos.list")
      .then((res) => res.repos)
      .catch((): string[] => [])
    const repos = mergeRepos(saved, taskRepos)
    if (repos.length === 0) {
      setNotice(auto.needRepo)
      return
    }
    dialog.set(
      <RoutineComposer
        repos={repos}
        tasks={(payload?.tasks ?? [])
          .filter((task) => !task.deleting)
          .map((task) => ({ id: task.id, title: task.title, repo: task.repo }))}
        defaultRepo={focusRepo}
        onSubmit={(draft) => {
          void (async () => {
            setBusy("new")
            try {
              await c.request("routine.create", {
                repo: draft.repo,
                name: draft.name,
                prompt: draft.prompt,
                schedule: draft.schedule,
                ...(draft.target ? { targetTask: draft.target.taskId, targetTab: draft.target.tabId } : {}),
              })
              reload()
            } catch (err) {
              // The daemon's cron error names the fix; carry it verbatim.
              toast(fill(auto.createFailed, { error: errorMessage(err) }), "error")
            } finally {
              setBusy(null)
            }
          })()
        }}
      />,
    )
  }

  const requestDelete = () => {
    if (!selected || busy) return
    const routine = selected
    dialog.set(
      <ConfirmDialog
        title={auto.deleteTitle}
        body={fill(auto.deleteBody, { name: routine.name })}
        confirmLabel={auto.deleteButton}
        onConfirm={async () => {
          setBusy(routine.id)
          try {
            await c.request("routine.delete", { id: routine.id })
            reload()
          } catch (err) {
            fail(auto.deleteFailed, routine.name, err)
          } finally {
            setBusy(null)
          }
        }}
      />,
    )
  }

  usePageKeys((e) => {
    if (e.ctrlKey) {
      if (e.key !== "c") return false
      page.set(null)
      return true
    }
    switch (e.key) {
      case "Escape":
      case "q":
        page.set(null)
        return true
      case "j":
      case "ArrowDown":
        setCursor(Math.min(rows.length - 1, at + 1))
        return true
      case "k":
      case "ArrowUp":
        setCursor(Math.max(0, at - 1))
        return true
      case "n":
        void createRoutine()
        return true
      case "r":
        reload()
        return true
      case "e":
        void toggleEnabled()
        return true
      case "s":
        void runNow()
        return true
      case "d":
        requestDelete()
        return true
      case "Enter": {
        // Newest first. Never fall through to an older run's task when the latest made none:
        // that would open a different run than the one shown first.
        const taskId = runs[0]?.taskId
        if (taskId) {
          page.set(null)
          model.select(taskId)
        } else if (runs.length > 0) setNotice(auto.latestRunNoTask)
        return true
      }
      default:
        return false
    }
  })

  const target = selected?.target
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className="page" tabIndex={0} ref={root}>
      <div className="pg-top">
        <h1 className="page-title">{auto.title}</h1>
        <span className="pg-actions mono">
          {needAttention > 0 && (
            <span className="tone-attention">
              {fill(auto.needAttention, { count: String(needAttention), total: String(rows.length) })}
            </span>
          )}
          <span className={reply?.keepsDaemonAlive ? "tone-success" : "muted"}>
            {reply?.keepsDaemonAlive ? auto.holdingDaemon : auto.notHolding}
          </span>
        </span>
      </div>

      {reply === null ? (
        <p className="muted">{common.loading}</p>
      ) : rows.length === 0 ? (
        <div className="pg-list">
          <p className="muted">{auto.empty}</p>
          <p>{auto.emptyHint}</p>
        </div>
      ) : (
        <div className="pg-list" ref={list}>
          {rows.map((routine, index) => {
            const last = lastRunStatus[routine.id]
            const tone = last ? runTone(last) : null
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the page's keys (j/k) move the cursor
              <div
                key={routine.id}
                data-row={index}
                className={`pg-row ${index === at ? "is-cursor" : ""} ${routine.enabled ? "" : "is-off"}`}
                onClick={() => setCursor(index)}
              >
                <span className="pg-name">{routine.name}</span>
                <span className="pg-grow muted mono">{`${projectLabel(
                  routine.repo,
                  rows.map((r) => r.repo),
                )} · ${routine.schedule}`}</span>
                {!routine.enabled && <span className="tone-warning mono">{auto.paused} ·</span>}
                <span className="muted mono">{when(routine.nextRunAt)}</span>
                <span className={`mono ${tone ? TONE_CLASS[tone] : "muted"}`} style={{ width: "1ch" }}>
                  {tone ? TONE_GLYPH[tone] : " "}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Always mounted, even with nothing selected: a panel that comes and goes makes the page jump. */}
      <div className="pg-detail">
        {selected ? (
          <>
            <div>
              <div className="pg-actions">
                <span className="pg-prompt pg-grow">{selected.prompt}</span>
                <button type="button" className="link" disabled={busy === selected.id} onClick={() => void runNow()}>
                  {auto.runNow}
                </button>
              </div>
              <p className="muted">
                {target
                  ? fill(auto.targetExisting, { task: titleOf(target.taskId), tab: target.tabId })
                  : selected.persistentSession
                    ? auto.targetStanding
                    : auto.targetFresh}
              </p>
              {selected.precheck && (
                <p className="muted mono">{fill(auto.precheck, { command: selected.precheck.command })}</p>
              )}
              <h2 className="kicker">{auto.recentRuns}</h2>
              {runs.length === 0 ? (
                <p className="muted">{auto.noRuns}</p>
              ) : (
                runs.slice(0, RUNS_SHOWN).map((run) => {
                  // A delivered run still owing its response reads as such; a missing one is a warning.
                  const state = routineRunResponseState(run, now)
                  const note =
                    state === "awaiting"
                      ? ` · ${auto.responseAwaiting}`
                      : state === "missing"
                        ? ` · ${auto.responseMissing}`
                        : ""
                  return (
                    <p
                      key={run.id}
                      className={`pg-run mono ${state === "missing" ? "tone-warning" : TONE_CLASS[runTone(run.status)]}`}
                    >
                      {`${run.trigger === "manual" ? "▸" : "·"} #${run.runNumber} ${statusText(run.status)}${run.tabId ? ` · ${run.tabId}` : ""}${run.error ? ` — ${run.error}` : ""}${note}  ${when(run.at)}`}
                    </p>
                  )
                })
              )}
              {runs[0]?.precheckResult && <PrecheckDetail run={runs[0]} />}
            </div>
            <div>
              <h2 className="kicker">{auto.responses}</h2>
              {runs.filter((run) => run.response).length === 0 ? (
                <p className="muted">{auto.noResponses}</p>
              ) : (
                runs
                  .filter((run) => run.response)
                  .map((run) => (
                    <div key={run.id}>
                      <p className={`pg-run mono ${TONE_CLASS[runTone(run.status)]}`}>
                        {`#${run.runNumber} ${statusText(run.status)} · ${when(run.response?.at)}`}
                      </p>
                      <p className="pg-response">{run.response?.text}</p>
                    </div>
                  ))
              )}
            </div>
          </>
        ) : (
          <p className="muted">{auto.noSelection}</p>
        )}
      </div>
      {notice && <p className="muted pg-notice">{notice}</p>}
    </div>
  )
}

/** Why the latest run did not run: the precheck's exit, duration and captured output (read-only). */
function PrecheckDetail({ run }: { run: AutomationRun }) {
  const { auto } = useCopy()
  const result = run.precheckResult
  if (!result) return null
  const exit = result.timedOut
    ? auto.precheckTimedOut
    : fill(auto.precheckExited, { code: String(result.exitCode ?? "?") })
  const streams = [
    { label: auto.precheckStdout, text: result.stdout },
    { label: auto.precheckStderr, text: result.stderr },
  ].filter((stream) => stream.text.trim().length > 0)
  return (
    <div>
      <h2 className="kicker">{fill(auto.precheckDetail, { exit, duration: String(result.durationMs) })}</h2>
      {streams.length === 0 ? (
        <p className="muted">{auto.precheckNoOutput}</p>
      ) : (
        streams.map((stream) => (
          <p key={stream.label} className="pg-response mono">
            {`${stream.label}: ${stream.text.replace(/\s+$/, "").split("\n").slice(-10).join("\n")}`}
          </p>
        ))
      )}
    </div>
  )
}
