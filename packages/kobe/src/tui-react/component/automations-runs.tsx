/** @jsxImportSource @opentui/react */
/**
 * The RUN HISTORY half of the Routines page: what a routine actually DID.
 *
 * Split from `automations-page.tsx` along the boundary the page already has.
 * Everything left there answers "what is scheduled and what can I do to it" —
 * the list, the cursor, create/pause/delete/run-now, the keymap. This answers
 * "did it run, and what happened": a read-only projection of the daemon's run
 * records, with no actions and no state of its own.
 *
 * Both halves render into the same detail box, so this exports the block
 * rather than the box — the page owns the frame and the order.
 */

import { TextAttributes } from "@opentui/core"
import type { AutomationRun } from "@sma1lboy/kobe-daemon/daemon/contracts"
import type { ReactNode } from "react"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { formatWhen } from "./automations-format"

/** Run-status → how it should read at a glance. The four "didn't run" reasons
 *  are deliberately distinct: `skipped_precheck` is healthy (nothing to do),
 *  `dispatch_failed` wants a human. Collapsing them would hide that. */
const RUN_TONE: Record<string, "success" | "muted" | "warning" | "error"> = {
  dispatched: "success",
  // Delivered, so not grey: `revived` reached a respawned session (the status
  // text carries the lost-context caveat), `deferred` reached the Inbox and is
  // warning rather than success because it is parked until a human releases it.
  revived: "success",
  deferred: "warning",
  skipped_precheck: "muted",
  skipped_missed: "warning",
  skipped_unavailable: "warning",
  dispatch_failed: "error",
}

/** `·` cron fired it, `▸` a human did. One cell, and it answers "did I run
 *  this or did the schedule" without opening anything. Both glyphs are
 *  already in the sidebar's vocabulary, so no new font coverage is at stake. */
function triggerGlyph(trigger: AutomationRun["trigger"]): string {
  return trigger === "manual" ? "▸" : "·"
}

/** The last ~10 lines of a captured stream, trimmed of trailing blanks.
 *  Truncation happens HERE and not at capture time: the runner already stores
 *  what it stores, and a detail view that shrank the record would make the
 *  next reader's question unanswerable. */
function outputTail(text: string, limit = 10): string[] {
  const lines = text.replace(/\s+$/, "").split("\n")
  return lines.length > limit ? lines.slice(-limit) : lines
}

/**
 * Why the latest run did not run: the precheck's exit code, how long it took,
 * and the output it actually produced.
 *
 * The runner has always captured `stdout`, `stderr`, `exitCode` and
 * `durationMs` on a `skipped_precheck` run and stored them on the record; the
 * page collapsed all four to `precheck exited 1`, which leaves reconstructing
 * the command by hand as the only way to find out what it said — the exact
 * debugging step Rove already did and then discarded.
 *
 * Scoped to the MOST RECENT run on purpose. That is the one that explains the
 * state the page is showing; an older skip is history, and reading it here
 * would answer a question about a routine that has since run fine. Showing it
 * unconditionally is also what keeps this off the keymap: a per-run cursor
 * needs a chord, and a chord needs the owner.
 *
 * An empty stream is omitted rather than printed as a blank label — a
 * precheck that wrote nothing to stderr should not look like one whose stderr
 * failed to load.
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
 * The recent-run list plus the latest run's precheck detail — the whole
 * "what happened" block, in the order it reads: newest runs first, then why
 * the top one did not run, when it did not.
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
          const tone = RUN_TONE[run.status] ?? "muted"
          const color =
            tone === "success"
              ? theme.success
              : tone === "warning"
                ? theme.warning
                : tone === "error"
                  ? theme.error
                  : theme.textMuted
          return (
            <text key={run.id} fg={color}>
              {`${triggerGlyph(run.trigger)} #${run.runNumber} ${run.status}${run.error ? ` \u2014 ${run.error}` : ""}  ${formatWhen(run.at, props.now)}`}
            </text>
          )
        })
      )}
      <PrecheckDetail run={runs[0]} />
    </>
  )
}
