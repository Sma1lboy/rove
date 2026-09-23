/** @jsxImportSource @opentui/react */
/**
 * The RUN HISTORY half of the Routines page: a read-only projection of the
 * daemon's run records, with no actions and no state of its own. Exports the
 * block, not the box — the page owns the shared detail frame and the order.
 */

import { type RGBA, TextAttributes } from "@opentui/core"
import { type AutomationRun, routineRunResponseState } from "@sma1lboy/kobe-daemon/daemon/contracts"
import type { ReactNode } from "react"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { formatRunStatus, formatWhen } from "./automations-format"
import { MarkdownText } from "./release-notes"

/** Run-status → glance tone. The "didn't run" reasons stay distinct:
 *  `skipped_precheck` is healthy, `dispatch_failed` wants a human. */
const RUN_TONE: Record<string, "success" | "muted" | "warning" | "error"> = {
  dispatched: "success",
  // Delivered, so not grey: `revived` reached a respawned session (the status
  // text carries the lost-context caveat).
  revived: "success",
  skipped_precheck: "muted",
  skipped_cancelled: "muted",
  skipped_missed: "warning",
  skipped_unavailable: "warning",
  dispatch_failed: "error",
}

/** A run's tone as a colour; shared with the list so glyph and history line agree. */
export function runToneColor(
  status: string,
  theme: { success: RGBA; warning: RGBA; error: RGBA; textMuted: RGBA },
): RGBA {
  const tone = RUN_TONE[status] ?? "muted"
  if (tone === "success") return theme.success
  if (tone === "warning") return theme.warning
  if (tone === "error") return theme.error
  return theme.textMuted
}

/**
 * Latest run in one cell, in the rail/Inbox vocabulary (`inbox-item-view.ts`):
 * `✓` done, `†` engine process gone, `!` wants a look, `·` nothing to do.
 */
export function runGlyph(status: string): string {
  const tone = RUN_TONE[status] ?? "muted"
  if (tone === "success") return "✓"
  if (tone === "error") return "†"
  if (tone === "warning") return "!"
  return "·"
}

/** `·` cron fired it, `▸` a human did (both glyphs already in the sidebar's font coverage). */
function triggerGlyph(trigger: AutomationRun["trigger"]): string {
  return trigger === "manual" ? "▸" : "·"
}

/** Last ~10 lines of a captured stream, trailing blanks trimmed. Truncated at
 *  display, never in the stored record. */
function outputTail(text: string, limit = 10): string[] {
  const lines = text.replace(/\s+$/, "").split("\n")
  return lines.length > limit ? lines.slice(-limit) : lines
}

/**
 * Why the latest run did not run: the precheck's exit code, duration, and
 * captured stdout/stderr from the `skipped_precheck` record.
 *
 * MOST RECENT run only: it explains the state on screen, and showing it
 * unconditionally avoids a per-run cursor (which would need a new chord).
 * An empty stream is omitted so it can't look like one that failed to load.
 */
function PrecheckDetail(props: { run: AutomationRun | undefined }): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const result = props.run?.precheckResult
  if (!result) return null
  const exit = result.timedOut
    ? t("automations.precheckTimedOut")
    : t("automations.precheckExited", { code: String(result.exitCode ?? "?") })
  const streams = [
    { label: t("automations.precheckStdout"), text: result.stdout },
    { label: t("automations.precheckStderr"), text: result.stderr },
  ].filter((stream) => stream.text.trim().length > 0)
  return (
    <box flexDirection="column" marginTop={1} flexShrink={0}>
      <text attributes={TextAttributes.BOLD} fg={theme.textMuted}>
        {t("automations.precheckDetail", { exit, duration: String(result.durationMs) })}
      </text>
      {streams.length === 0 ? (
        <text fg={theme.textMuted}>{t("automations.precheckNoOutput")}</text>
      ) : (
        streams.map((stream) => (
          <box key={stream.label} flexDirection="row" gap={1}>
            <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
              {`${stream.label}:`}
            </text>
            <text fg={theme.text} flexShrink={1}>
              {outputTail(stream.text).join("\n")}
            </text>
          </box>
        ))
      )}
    </box>
  )
}

/**
 * Recent runs newest-first, then why the top one did not run (when it didn't).
 */
export function RunHistory(props: { runs: readonly AutomationRun[]; now: number }): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const runs = props.runs
  return (
    <>
      <text attributes={TextAttributes.BOLD} fg={theme.text}>
        {t("automations.recentRuns")}
      </text>
      {runs.length === 0 ? (
        <text fg={theme.textMuted}>{t("automations.noRuns")}</text>
      ) : (
        runs.slice(0, 5).map((run) => {
          // A delivered run still owing its response reads as such; missing is a warning.
          const pending = routineRunResponseState(run, props.now)
          const note =
            pending === "awaiting"
              ? ` · ${t("automations.responseAwaiting")}`
              : pending === "missing"
                ? ` · ${t("automations.responseMissing")}`
                : ""
          return (
            <text key={run.id} fg={pending === "missing" ? theme.warning : runToneColor(run.status, theme)}>
              {`${triggerGlyph(run.trigger)} #${run.runNumber} ${formatRunStatus(run.status, t)}${run.tabId ? ` · ${run.tabId}` : ""}${run.error ? ` \u2014 ${run.error}` : ""}${note}  ${formatWhen(run.at, props.now)}`}
            </text>
          )
        })
      )}
      <PrecheckDetail run={runs[0]} />
    </>
  )
}

/** Responses newest first, each headed by the run it answers. Markdown body. */
export function RunResponses(props: { runs: readonly AutomationRun[]; now: number }): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const answered = props.runs.filter((run) => run.response)
  return (
    <>
      <text attributes={TextAttributes.BOLD} fg={theme.text} flexShrink={0}>
        {t("automations.responses")}
      </text>
      {answered.length === 0 ? (
        <text fg={theme.textMuted}>{t("automations.noResponses")}</text>
      ) : (
        <scrollbox flexGrow={1} flexShrink={1} flexBasis={0}>
          {answered.map((run) => (
            <box key={run.id} flexDirection="column" marginBottom={1} flexShrink={0}>
              <text fg={runToneColor(run.status, theme)} wrapMode="none">
                {`#${run.runNumber} ${formatRunStatus(run.status, t)} · ${formatWhen(run.response?.at, props.now)}`}
              </text>
              <MarkdownText content={run.response?.text ?? ""} />
            </box>
          ))}
        </scrollbox>
      )}
    </>
  )
}
