/**
 * The Routines page's run log: every routine's recent runs in one list, newest first, each with what fired it,
 * how long it took and how it ended (blocked, waiting on a person, is not failed). Chips filter by routine and
 * outcome; a run that made a session opens it.
 */

import { type AutomationRun, routineRunResponseState } from "@sma1lboy/rove/src/tui/component/automation-run-core.ts"
import { useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { t, useLocale } from "./i18n/index.ts"
import { fill, useCopy } from "./pages-kit.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import {
  OUTCOMES,
  type Outcome,
  SOURCES,
  filterRuns,
  formatDuration,
  outcomeOf,
  runDurationMs,
} from "./routine-run-log.ts"
import { runErrorText } from "./routine-run-text.ts"
import { TONE_CLASS, TONE_GLYPH, runTone } from "./routine-runs.tsx"
import { Button } from "./ui/button.tsx"
import { RT_GROW, RT_RUN, RT_RUN_ERROR, RT_RUN_LINE, RT_RUN_OPEN, RT_RUN_ROUTINE } from "./ui/routines.ts"
import { KICKER } from "./ui/text.ts"

/** How many runs the log lists before it says how many more there are. */
const SHOWN = 30

type RunsByRoutine = Readonly<Record<string, readonly AutomationRun[]>>

/** Every routine's run history, re-read on `tick`; a routine whose read fails keeps what it last showed. */
export function useRoutineRuns(c: BridgeClient, ids: readonly string[], tick: number): RunsByRoutine {
  const key = ids.join("\0")
  const [runs, setRuns] = useState<RunsByRoutine>(() =>
    Object.fromEntries(
      ids.map((id) => [id, lastReply<{ runs: AutomationRun[] }>(c, "routine.runs", { id })?.runs ?? []]),
    ),
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `ids`; tick is a trigger
  useEffect(() => {
    let live = true
    for (const id of ids) {
      requestRemembered<{ runs: AutomationRun[] }>(c, "routine.runs", { id })
        .then((res) => live && setRuns((prev) => ({ ...prev, [id]: res.runs })))
        .catch(() => undefined)
    }
    return () => {
      live = false
    }
  }, [c, key, tick])
  return runs
}

/** The run's tone: a blocked run waits on someone, so it is a warning rather than the healthy grey of a skip. */
function toneOf(run: AutomationRun): keyof typeof TONE_CLASS {
  return outcomeOf(run) === "blocked" ? "warning" : runTone(run.status)
}

export function RunLog(props: {
  runs: RunsByRoutine
  routines: readonly { readonly id: string; readonly name: string }[]
  /** The routine the page's cursor is on: the log starts on it, and follows it. */
  followId: string | undefined
  now: number
  when: (iso: string | undefined) => string
  openRun: (taskId: string) => void
}) {
  useLocale()
  const { auto } = useCopy()
  // `null` follows the cursor; "" is every routine.
  const [routine, setRoutine] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the cursor moving is the trigger
  useEffect(() => setRoutine(null), [props.followId])
  const scope = routine === null ? (props.followId ?? "") : routine
  const nameOf = new Map(props.routines.map((r) => [r.id, r.name]))
  const shown = filterRuns(props.runs, scope === "" ? null : scope, outcome)
  const statusText = (run: AutomationRun): string => {
    if (run.status === "skipped_blocked") {
      const reason = run.blocked?.reason
      return reason
        ? fill(t("runLog.blockedRun"), { reason: t(`runLog.blocked.${reason}`) })
        : t("runLog.outcome.blocked")
    }
    return (auto.runStatus as Record<string, string>)[run.status] ?? run.status
  }
  const chip = (label: string, on: boolean, pick: () => void, key: string) => (
    <Button key={key} variant="pill" hit="tight" aria-current={on} className="max-w-40 truncate" onClick={pick}>
      {`[ ${label} ]`}
    </Button>
  )
  return (
    <>
      <h2 className={`${KICKER} text-muted`}>{t("runLog.title")}</h2>
      {props.routines.length > 1 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {chip(t("runLog.all"), scope === "", () => setRoutine(""), "all")}
          {props.routines.map((r) => chip(r.name, scope === r.id, () => setRoutine(r.id), r.id))}
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {chip(t("runLog.all"), outcome === null, () => setOutcome(null), "all")}
        {OUTCOMES.map((o) => chip(t(`runLog.outcome.${o}`), outcome === o, () => setOutcome(o), o))}
      </div>
      {shown.length === 0 ? (
        <p className="text-muted">
          {filterRuns(props.runs, scope === "" ? null : scope, null).length === 0 ? auto.noRuns : t("runLog.empty")}
        </p>
      ) : (
        shown.slice(0, SHOWN).map((run) => {
          const tone = toneOf(run)
          const state = routineRunResponseState(run, props.now)
          const note =
            state === "awaiting" ? `, ${auto.responseAwaiting}` : state === "missing" ? `, ${auto.responseMissing}` : ""
          const duration = runDurationMs(run)
          const line = (
            <>
              <span>{TONE_GLYPH[tone]}</span>
              <span>{`#${run.runNumber}`}</span>
              {scope === "" && <span className={RT_RUN_ROUTINE}>{nameOf.get(run.automationId) ?? ""}</span>}
              <span className={RT_GROW}>{`${statusText(run)}${run.tabId ? `, ${run.tabId}` : ""}${note}`}</span>
              <span className="text-subtle">{t(`runLog.source.${SOURCES[run.trigger]}`)}</span>
              {duration !== null && <span className="text-muted">{formatDuration(duration)}</span>}
              <span className="text-muted">{props.when(run.at)}</span>
            </>
          )
          const error = run.error ? runErrorText(run.error) : null
          const taskId = run.taskId
          const color = state === "missing" ? "text-warning" : TONE_CLASS[tone]
          return (
            <div key={run.id} className={`${RT_RUN} ${color}`}>
              {taskId ? (
                <button type="button" className={`mono ${RT_RUN_OPEN}`} onClick={() => props.openRun(taskId)}>
                  {line}
                </button>
              ) : (
                <span className={`mono ${RT_RUN_LINE}`}>{line}</span>
              )}
              {error && (
                <details className={`mono ${RT_RUN_ERROR}`}>
                  <summary>{error.summary}</summary>
                  <pre>{error.full}</pre>
                </details>
              )}
            </div>
          )
        })
      )}
      {shown.length > SHOWN && <p className="text-muted">{t("runLog.more", { count: shown.length - SHOWN })}</p>}
    </>
  )
}
