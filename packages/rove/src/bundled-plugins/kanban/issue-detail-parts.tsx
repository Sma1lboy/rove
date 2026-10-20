/** @jsxImportSource @opentui/react */
/**
 * The story drawer's EVENTS feed — the last {@link EVENT_FEED_LIMIT} engine
 * lifecycle events of the story's linked task (docs/design/plugin-events.md).
 *
 * The feed is a SNAPSHOT: one fetch when the drawer mounts, no polling and
 * no subscription. The daemon's ring is in-memory and capped at 100, so a
 * fresh daemon — or an id it does not know ("task not found") — simply
 * reads as "no events", never as an error the user must act on.
 */

import { useEffect, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import type { EventRow } from "../../tui-react/component/issue-events-core"
import { host, hostFn } from "./host"

const useTheme = hostFn((h) => h.theme.useTheme)
const useT = hostFn((h) => h.i18n.useT)
const DialogLabel = hostFn((h) => h.dialog.DialogLabel)
const eventRows = hostFn((h) => h.issues.events.eventRows)

/** Width of the age column — "999d" is the widest {@link relativeAge} yield. */
const AGE_CELLS = 4

export function IssueEventsSection(props: { taskId: string; orchestrator: RemoteOrchestrator | null }) {
  const { theme } = useTheme()
  const t = useT()
  // null = still loading; [] = nothing recorded (or the daemon forgot).
  const [rows, setRows] = useState<readonly EventRow[] | null>(null)

  useEffect(() => {
    const orch = props.orchestrator
    if (!orch) {
      setRows([])
      return
    }
    let live = true
    void orch
      .recentTaskEvents(props.taskId)
      .then((result) => {
        if (live) setRows(eventRows(result.events, Date.now(), host().issues.events.EVENT_FEED_LIMIT))
      })
      .catch(() => {
        if (live) setRows([])
      })
    return () => {
      live = false
    }
  }, [props.orchestrator, props.taskId])

  return (
    <box gap={0}>
      <DialogLabel label={t("kanban.detail.eventsLabel")} focused={false} />
      {rows === null ? (
        <text fg={theme.textMuted}>{t("kanban.detail.eventsLoading")}</text>
      ) : rows.length === 0 ? (
        <text fg={theme.textMuted}>{t("kanban.detail.eventsNone")}</text>
      ) : (
        rows.map((row) => (
          <box key={row.key} flexDirection="row" gap={1}>
            <text fg={theme.textMuted} wrapMode="none">
              {row.age.padStart(AGE_CELLS)}
            </text>
            <text fg={theme.text} wrapMode="none">
              {row.kind}
            </text>
            {row.tail ? (
              <text fg={theme.textMuted} wrapMode="none">
                · {row.tail}
              </text>
            ) : null}
          </box>
        ))
      )}
    </box>
  )
}
