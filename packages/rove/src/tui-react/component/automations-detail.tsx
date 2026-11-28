/** @jsxImportSource @opentui/react */
/**
 * Detail panel of the Routines page: selected routine prompt/target/engine/events/precheck,
 * Run now button, run history, and responses. Split out of `automations-page.tsx` so the page
 * owns the list + keyboard actions and this file owns rendering one selected routine.
 */

import { TextAttributes } from "@opentui/core"
import { routineWebhookPath } from "@sma1lboy/rove-core/automations/automation-trigger-core.ts"
import { type Automation, type AutomationRun, formatEventTriggers } from "@sma1lboy/rove-daemon/daemon/contracts"
import type { ReactNode } from "react"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { FRAME } from "../ui/frame"
import { formatWhen } from "./automations-format"
import { RunHistory, RunResponses } from "./automations-runs"

export function AutomationsDetail(props: {
  selected: Automation | undefined
  runs: readonly AutomationRun[]
  busy: boolean
  engineFull: string | null
  targetTitle: string | undefined
  lastFailure: { readonly at: string; readonly reason: string } | undefined
  now: number
  onRunNow: () => void
  onOpenTask?: (taskId: string) => void
}): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const { selected, runs, now } = props
  const eventsText = selected ? formatEventTriggers(selected) : ""
  return (
    <box
      flexDirection="row"
      marginTop={1}
      {...FRAME}
      borderColor={theme.border}
      padding={1}
      gap={2}
      {...(selected ? { flexGrow: 1, flexShrink: 1, flexBasis: 0 } : { flexShrink: 0 })}
    >
      {selected ? (
        <>
          <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0}>
            <box flexDirection="row" justifyContent="space-between" gap={2}>
              <text fg={theme.text} wrapMode="none" flexShrink={1} flexGrow={1}>
                {selected.prompt}
              </text>
              <text
                fg={props.busy ? theme.textMuted : theme.primary}
                attributes={TextAttributes.BOLD}
                wrapMode="none"
                flexShrink={0}
                onMouseUp={props.onRunNow}
              >
                {t("automations.runNow")}
              </text>
            </box>
            <text fg={theme.textMuted} wrapMode="word">
              {selected.target
                ? t("automations.targetExisting", {
                    task: props.targetTitle ?? selected.target.taskId,
                    tab: selected.target.tabId,
                  })
                : t(
                    selected.persistentSession
                      ? selected.newConversation
                        ? "automations.targetStandingNew"
                        : "automations.targetStanding"
                      : "automations.targetFresh",
                  )}
            </text>
            {props.engineFull ? <text fg={theme.textMuted}>{props.engineFull}</text> : null}
            {eventsText ? (
              <text fg={theme.textMuted}>{t("automations.detailEvents", { events: eventsText })}</text>
            ) : null}
            {selected.webhook ? (
              <text fg={theme.textMuted}>
                {t("automations.detailWebhook", { path: routineWebhookPath(selected.id) })}
              </text>
            ) : null}
            {selected.precheck ? (
              <text fg={theme.textMuted}>{t("automations.precheck", { command: selected.precheck.command })}</text>
            ) : null}
            {props.lastFailure ? (
              <text fg={theme.warning} wrapMode="word">
                {t("automations.lastFailed", {
                  when: formatWhen(props.lastFailure.at, now),
                  reason: props.lastFailure.reason,
                })}
              </text>
            ) : null}
            <RunHistory runs={runs} now={now} onOpenTask={props.onOpenTask} />
          </box>
          <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0}>
            <RunResponses runs={runs} now={now} />
          </box>
        </>
      ) : (
        <text fg={theme.textMuted}>{t("automations.noSelection")}</text>
      )}
    </box>
  )
}
