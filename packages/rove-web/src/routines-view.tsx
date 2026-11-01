/**
 * The Routines page (TUI `automations-page.tsx`): the daemon's scheduled routines grouped as needs
 * you / active / paused, beside the selected one's schedule, prompt, recent runs and responses (stacked
 * on a narrow page). j/k or arrows move, `n` composes a routine, and on the cursor row `e` pauses or
 * resumes, `s` (or the Run now button) runs it now, `d` deletes after a confirm, Enter opens the latest
 * run's task, `r` refetches, q/Esc close. Prechecks, grace windows and standing-session mode stay
 * CLI-only (`rove api routine-update`).
 */

import {
  type Automation,
  type AutomationRun,
  type AutomationRunStatus,
  automationRunNeedsAttention,
} from "@sma1lboy/rove/src/tui/component/automation-run-core.ts"
import { describeCronWith } from "@sma1lboy/rove/src/tui/component/cron-core.ts"
import { useEffect, useRef, useState } from "react"
import { ConfirmDialog } from "./dialogs.tsx"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import {
  errorMessage,
  fill,
  mergeRepos,
  projectLabel,
  useCopy,
  useCronTranslate,
  usePageFocus,
  usePageKeys,
  useReload,
  useSelectedRepo,
  useTaskRepos,
} from "./pages-kit.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { RoutineComposer } from "./routine-composer.tsx"
import { RoutineRuns, TONE_CLASS, TONE_GLYPH, runTone } from "./routine-runs.tsx"
import { useStore } from "./store.ts"
import { dialog, page, routineFocus, toast } from "./ui.ts"
import { PAGE, PAGE_TITLE, PG_ACTIONS, PG_ACTION_LINK, PG_LIST, PG_NOTICE, PG_TOP } from "./ui/page.ts"
import {
  RT_BODY,
  RT_DETAIL,
  RT_GROUP,
  RT_HEAD,
  RT_LIST,
  RT_META,
  RT_NAME,
  RT_PAGE,
  RT_PROMPT,
  RT_ROW_LINE,
  RT_ROW_SUB,
  RT_WHEN,
  rtNameClass,
  rtRowClass,
} from "./ui/routines.ts"
import { KICKER, LINK } from "./ui/text.ts"

const POLL_MS = 5_000

interface RoutinesReply {
  readonly automations: readonly Automation[]
  readonly keepsDaemonAlive: boolean
  readonly lastRunStatus?: Readonly<Record<string, AutomationRunStatus>>
  /** The newest failure among recent runs; absent when none failed (or an older daemon). */
  readonly lastFailure?: Readonly<Record<string, { readonly at: string; readonly reason: string }>>
}

export function RoutinesView({ model }: { model: AppModel }) {
  const { auto, common } = useCopy()
  const c = model.client
  const [tick, reload] = useReload(POLL_MS)
  const payload = useStore(model.tasks)
  const taskRepos = useTaskRepos(model)
  const focusRepo = useSelectedRepo(model)
  const [reply, setReply] = useState<RoutinesReply | null>(() => lastReply<RoutinesReply>(c, "routine.list") ?? null)
  const [runs, setRuns] = useState<readonly AutomationRun[]>([])
  // The cursor follows the routine, not its row: pausing one moves it to another group.
  const [cursorId, setCursorId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const root = usePageFocus()
  const cronT = useCronTranslate()
  const intl = useLocale() === "zh" ? "zh-CN" : "en-US"
  const detail = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a trigger the body doesn't read
  useEffect(() => {
    let live = true
    requestRemembered<RoutinesReply>(c, "routine.list")
      .then((res) => live && setReply(res))
      // Stale rows beat none until the next poll succeeds.
      .catch(() => live && setReply((prev) => prev ?? { automations: [], keepsDaemonAlive: false }))
    return () => {
      live = false
    }
  }, [c, tick])

  const listed = reply?.automations ?? []
  const lastRunStatus = reply?.lastRunStatus ?? {}
  const lastFailure = reply?.lastFailure ?? {}
  const needsYou = (routine: Automation) => {
    const status = lastRunStatus[routine.id]
    return status !== undefined && automationRunNeedsAttention(status)
  }
  // What wants a human first, then what runs, then what is paused; daemon order within each.
  const sections = [
    { key: "pages.routinesNeedYou", rows: listed.filter(needsYou) },
    { key: "pages.routinesActive", rows: listed.filter((routine) => routine.enabled && !needsYou(routine)) },
    { key: "pages.routinesPaused", rows: listed.filter((routine) => !routine.enabled && !needsYou(routine)) },
  ]
  const rows = sections.flatMap((section) => section.rows)
  const at = Math.max(
    0,
    rows.findIndex((routine) => routine.id === cursorId),
  )
  const selected = rows[at]
  const setCursor = (index: number) => setCursorId(rows[index]?.id ?? null)
  const needAttention = sections[0]?.rows.length ?? 0

  // An Inbox row for a failed routine lands the cursor on that routine, once.
  const wanted = useStore(routineFocus)
  useEffect(() => {
    if (wanted === null || !reply) return
    if (reply.automations.some((routine) => routine.id === wanted)) setCursorId(wanted)
    routineFocus.set(null)
  }, [wanted, reply])

  // Run history follows the cursor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a trigger
  useEffect(() => {
    let live = true
    if (!selected) {
      setRuns([])
      return
    }
    // The cursor's routine shows its runs as last read, not the previous routine's, until the reread lands.
    const last = lastReply<{ runs: AutomationRun[] }>(c, "routine.runs", { id: selected.id })
    if (last) setRuns(last.runs)
    requestRemembered<{ runs: AutomationRun[] }>(c, "routine.runs", { id: selected.id })
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
  // A tap asks for the detail; keys keep the cursor row in view. One effect, so neither scroll cancels the other.
  const [reveal, setReveal] = useState(0)
  const revealed = useRef(0)
  useEffect(() => {
    const panel = detail.current
    const tapped = reveal !== revealed.current
    revealed.current = reveal
    // Stacked (narrow) only: the detail sits under the list instead of beside it.
    if (tapped && panel && list.current && panel.offsetTop > list.current.offsetTop) {
      panel.scrollIntoView({ block: "start", behavior: "smooth" })
      return
    }
    list.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: "nearest" })
  }, [at, reveal])

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
  const titleOf = (taskId: string) => payload?.tasks.find((task) => task.id === taskId)?.title ?? taskId
  const openRun = (taskId: string) => {
    page.set(null)
    model.select(taskId)
  }

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
                ...(draft.repo === null ? {} : { repo: draft.repo }),
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
        if (taskId) openRun(taskId)
        else if (runs.length > 0) setNotice(auto.latestRunNoTask)
        return true
      }
      default:
        return false
    }
  })

  const target = selected?.target
  const described = selected ? describeCronWith(selected.schedule, cronT) : null
  const repoName = (repo: string | undefined) =>
    repo === undefined
      ? t("rail.noProject")
      : projectLabel(
          repo,
          listed.flatMap((r) => r.repo ?? []),
        )
  const nextAt = selected?.nextRunAt ? Date.parse(selected.nextRunAt) : Number.NaN
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className={`${PAGE} ${RT_PAGE}`} tabIndex={0} ref={root}>
      <div className={PG_TOP}>
        <h1 className={PAGE_TITLE}>{auto.title}</h1>
        <span className={`mono ${PG_ACTIONS}`}>
          {needAttention > 0 && (
            <span className="text-error">
              {fill(auto.needAttention, { count: String(needAttention), total: String(rows.length) })}
            </span>
          )}
          <span className={reply?.keepsDaemonAlive ? "text-success" : "text-muted"}>
            {reply?.keepsDaemonAlive ? auto.holdingDaemon : auto.notHolding}
          </span>
          {/* Every page key has a click target too: a phone has no n/e/d. */}
          <button type="button" className={`${LINK} ${PG_ACTION_LINK.header}`} onClick={() => void createRoutine()}>
            {t("pages.new")}
          </button>
        </span>
      </div>

      {reply === null ? (
        <p className="text-muted">{common.loading}</p>
      ) : rows.length === 0 ? (
        <div className={PG_LIST}>
          <p className="text-muted">{auto.empty}</p>
          <p className="keys-only">{auto.emptyHint}</p>
        </div>
      ) : (
        <div className={RT_BODY}>
          <div className={RT_LIST} ref={list}>
            {sections.map((section) =>
              section.rows.length === 0 ? null : (
                <section key={section.key}>
                  <h2 className={`${KICKER} ${RT_GROUP} ${section === sections[0] ? "text-error" : "text-muted"}`}>
                    {t(section.key)} <span className="mono">{section.rows.length}</span>
                  </h2>
                  {section.rows.map((routine) => {
                    const index = rows.indexOf(routine)
                    const last = lastRunStatus[routine.id]
                    const tone = last ? runTone(last) : null
                    return (
                      // biome-ignore lint/a11y/useKeyWithClickEvents: the page's keys (j/k) move the cursor
                      <div
                        key={routine.id}
                        data-row={index}
                        className={rtRowClass(index === at)}
                        onClick={() => {
                          setCursor(index)
                          setReveal((n) => n + 1)
                        }}
                      >
                        <span className={RT_ROW_LINE}>
                          <span className={rtNameClass(!routine.enabled)}>{routine.name}</span>
                          <span className={`mono text-muted ${RT_WHEN}`}>
                            {routine.enabled ? when(routine.nextRunAt) : auto.paused}
                          </span>
                          <span className={`mono ${tone ? TONE_CLASS[tone] : "text-muted"}`} style={{ width: "1ch" }}>
                            {tone ? TONE_GLYPH[tone] : " "}
                          </span>
                        </span>
                        <span className={`mono text-muted ${RT_ROW_SUB}`} title={routine.schedule}>
                          {`${repoName(routine.repo)} · ${describeCronWith(routine.schedule, cronT) ?? routine.schedule}`}
                        </span>
                        {lastFailure[routine.id] ? (
                          <span className={`mono text-warning ${RT_ROW_SUB}`} title={lastFailure[routine.id]?.reason}>
                            {fill(auto.lastFailed, {
                              when: when(lastFailure[routine.id]?.at),
                              reason: lastFailure[routine.id]?.reason ?? "",
                            })}
                          </span>
                        ) : null}
                      </div>
                    )
                  })}
                </section>
              ),
            )}
          </div>

          {/* Always mounted, even with nothing selected: a panel that comes and goes makes the page jump. */}
          <div className={RT_DETAIL} ref={detail}>
            {selected ? (
              <>
                <div className={RT_HEAD}>
                  <h2 className={RT_NAME}>{selected.name}</h2>
                  <span className={`mono ${PG_ACTIONS}`}>
                    <button
                      type="button"
                      className={`${LINK} ${PG_ACTION_LINK.row}`}
                      disabled={busy === selected.id}
                      onClick={() => void runNow()}
                    >
                      {auto.runNow}
                    </button>
                    <button
                      type="button"
                      className={`${LINK} ${PG_ACTION_LINK.row}`}
                      disabled={busy === selected.id}
                      onClick={() => void toggleEnabled()}
                    >
                      {t(selected.enabled ? "pages.routinePause" : "pages.routineEnable")}
                    </button>
                    <button
                      type="button"
                      className={`${LINK} ${PG_ACTION_LINK.row}`}
                      disabled={busy === selected.id}
                      onClick={requestDelete}
                    >
                      {t("pages.delete")}
                    </button>
                  </span>
                </div>
                <dl className={RT_META}>
                  <dt className="text-muted">{t("pages.routineSchedule")}</dt>
                  <dd>
                    {described ?? <span className="mono">{selected.schedule}</span>}
                    {described && <span className="mono text-muted">{`  ${selected.schedule}`}</span>}
                  </dd>
                  <dt className="text-muted">{t("pages.routineNext")}</dt>
                  <dd className={selected.enabled ? "" : "text-warning"}>
                    {selected.enabled
                      ? Number.isFinite(nextAt)
                        ? `${when(selected.nextRunAt)} · ${new Date(nextAt).toLocaleString(intl, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}`
                        : "—"
                      : auto.paused}
                  </dd>
                  <dt className="text-muted">{t("pages.routineProject")}</dt>
                  <dd>{repoName(selected.repo)}</dd>
                  {/* A script routine runs a command, not an engine: nothing is delivered anywhere. */}
                  {!selected.script && (
                    <>
                      <dt className="text-muted">{t("pages.routineDelivers")}</dt>
                      <dd>
                        {target
                          ? fill(auto.targetExisting, { task: titleOf(target.taskId), tab: target.tabId })
                          : selected.persistentSession
                            ? auto.targetStanding
                            : auto.targetFresh}
                      </dd>
                    </>
                  )}
                </dl>
                {selected.precheck && (
                  <p className="mono text-muted">{fill(auto.precheck, { command: selected.precheck.command })}</p>
                )}
                {selected.script ? (
                  <>
                    <h2 className={`${KICKER} text-muted`}>{t("pages.routineScript")}</h2>
                    <p className={`mono ${RT_PROMPT}`}>{selected.script.command}</p>
                  </>
                ) : (
                  <>
                    <h2 className={`${KICKER} text-muted`}>{t("pages.routinePrompt")}</h2>
                    <p className={RT_PROMPT}>{selected.prompt}</p>
                  </>
                )}

                <RoutineRuns runs={runs} now={now} when={when} openRun={openRun} />
              </>
            ) : (
              <p className="text-muted">{auto.noSelection}</p>
            )}
          </div>
        </div>
      )}
      {notice && <p className={`text-muted ${PG_NOTICE}`}>{notice}</p>}
    </div>
  )
}
