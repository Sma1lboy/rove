/**
 * The selected routine's run history, latest precheck and responses (the Routines page's detail,
 * below its schedule and prompt). Run tones and glyphs are shared with the page's list rows.
 */

import { type AutomationRun, routineRunResponseState } from "@sma1lboy/rove/src/tui/component/automation-run-core.ts"
import { fill, useCopy } from "./pages-kit.ts"
import { responseText, runErrorText } from "./routine-run-text.ts"
import {
  RT_GROW,
  RT_RESPONSE,
  RT_RUN,
  RT_RUN_ERROR,
  RT_RUN_HEAD,
  RT_RUN_LINE,
  RT_RUN_OPEN,
  rtResponseClass,
} from "./ui/routines.ts"
import { KICKER } from "./ui/text.ts"

/** How many runs the history lists (the TUI's `runs.slice(0, 5)`). */
const RUNS_SHOWN = 5

/** Run-status → glance tone. `skipped_precheck` is healthy, `dispatch_failed` wants a human. */
const RUN_TONE: Record<string, "success" | "muted" | "warning" | "error"> = {
  dispatched: "success",
  revived: "success",
  skipped_precheck: "muted",
  skipped_cancelled: "muted",
  skipped_missed: "warning",
  skipped_unavailable: "warning",
  dispatch_failed: "error",
  ran: "success",
  script_failed: "error",
}
export const TONE_CLASS = {
  success: "text-success",
  muted: "text-muted",
  warning: "text-warning",
  error: "text-error",
} as const
export const TONE_GLYPH = { success: "✓", error: "†", warning: "!", muted: "·" } as const

export const runTone = (status: string) => RUN_TONE[status] ?? "muted"

export function RoutineRuns(props: {
  runs: readonly AutomationRun[]
  now: number
  when: (iso: string | undefined) => string
  openRun: (taskId: string) => void
}) {
  const { auto } = useCopy()
  const { runs, now, when } = props
  const statusText = (status: string) => (auto.runStatus as Record<string, string>)[status] ?? status
  const responded = runs.filter((run) => run.response)
  return (
    <>
      <h2 className={`${KICKER} text-muted`}>{auto.recentRuns}</h2>
      {runs.length === 0 ? (
        <p className="text-muted">{auto.noRuns}</p>
      ) : (
        runs.slice(0, RUNS_SHOWN).map((run) => {
          // A delivered run still owing its response reads as such; a missing one is a warning.
          const state = routineRunResponseState(run, now)
          const note =
            state === "awaiting" ? `, ${auto.responseAwaiting}` : state === "missing" ? `, ${auto.responseMissing}` : ""
          const tone = state === "missing" ? "text-warning" : TONE_CLASS[runTone(run.status)]
          const line = (
            <>
              <span>{run.trigger === "manual" ? "▸" : "·"}</span>
              <span>{`#${run.runNumber}`}</span>
              <span className={RT_GROW}>{`${statusText(run.status)}${run.tabId ? `, ${run.tabId}` : ""}${note}`}</span>
              <span className="text-muted">{when(run.at)}</span>
            </>
          )
          const error = run.error ? runErrorText(run.error) : null
          // The rail lists no routine runs: a run that made a session opens it from here.
          const taskId = run.taskId
          return (
            <div key={run.id} className={`${RT_RUN} ${tone}`}>
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
      {runs[0]?.precheckResult && <PrecheckDetail run={runs[0]} />}

      <h2 className={`${KICKER} text-muted`}>{auto.responses}</h2>
      {responded.length === 0 ? (
        <p className="text-muted">{auto.noResponses}</p>
      ) : (
        responded.map((run) => (
          <div key={run.id} className={RT_RESPONSE}>
            <p className={`mono ${RT_RUN_HEAD} ${TONE_CLASS[runTone(run.status)]}`}>
              {`#${run.runNumber} ${statusText(run.status)}, ${when(run.response?.at)}`}
            </p>
            <p className={rtResponseClass(false)}>{responseText(run.response?.text ?? "")}</p>
          </div>
        ))
      )}
    </>
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
      <h2 className={`${KICKER} text-muted`}>
        {fill(auto.precheckDetail, { exit, duration: String(result.durationMs) })}
      </h2>
      {streams.length === 0 ? (
        <p className="text-muted">{auto.precheckNoOutput}</p>
      ) : (
        streams.map((stream) => (
          <p key={stream.label} className={`mono ${rtResponseClass(true)}`}>
            {`${stream.label}: ${stream.text.replace(/\s+$/, "").split("\n").slice(-10).join("\n")}`}
          </p>
        ))
      )}
    </div>
  )
}
