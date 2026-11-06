/**
 * The selected routine's latest precheck and responses (the Routines page's detail, below its schedule
 * and prompt; the run log is `routine-run-log.tsx`). Run tones and glyphs are shared with the page's list rows.
 */

import type { AutomationRun } from "@sma1lboy/rove/src/tui/component/automation-run-core.ts"
import { fill, useCopy } from "./pages-kit.ts"
import { responseText } from "./routine-run-text.ts"
import { RT_RESPONSE, RT_RUN_HEAD, rtResponseClass } from "./ui/routines.ts"
import { KICKER } from "./ui/text.ts"

/** Run-status → glance tone. `skipped_precheck` is healthy, `dispatch_failed` wants a human. */
const RUN_TONE: Record<string, "success" | "muted" | "warning" | "error"> = {
  dispatched: "success",
  revived: "success",
  skipped_precheck: "muted",
  // Waiting on a person or a limit whose cause is already in the Inbox: noticeable, not an alarm.
  skipped_blocked: "warning",
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
  when: (iso: string | undefined) => string
}) {
  const { auto } = useCopy()
  const { runs, when } = props
  const statusText = (status: string) => (auto.runStatus as Record<string, string>)[status] ?? status
  const responded = runs.filter((run) => run.response)
  return (
    <>
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
