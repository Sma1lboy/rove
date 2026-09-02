/** @jsxImportSource @opentui/react */
/**
 * Story-drawer parts that outgrew `issue-detail-dialog.tsx`: the BOLD CAPS
 * section header every section wears, the bordered CHIP the drawer's four
 * pickers and both linked-story actions are all built from, and the EVENTS
 * feed — the last
 * {@link EVENT_FEED_LIMIT} engine lifecycle events of the story's linked
 * task (docs/design/plugin-events.md).
 *
 * The feed is a SNAPSHOT: one fetch when the drawer mounts, no polling and
 * no subscription. The daemon's ring is in-memory and capped at 100, so a
 * fresh daemon — or an id it no longer knows ("task not found") — simply
 * reads as "no events", never as an error the user must act on.
 */

import { TextAttributes } from "@opentui/core"
import { useEffect, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { FRAME } from "../ui/frame"
import { EVENT_FEED_LIMIT, type EventRow, eventRows } from "./issue-events-core"

/** Section header: BOLD CAPS, primary + underlined when its field is focused. */
export function SectionHeader(props: { label: string; focused: boolean; hint?: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={2}>
      <text
        fg={props.focused ? theme.primary : theme.textMuted}
        attributes={props.focused ? TextAttributes.BOLD | TextAttributes.UNDERLINE : TextAttributes.BOLD}
        wrapMode="none"
      >
        {props.label}
      </text>
      {props.hint ? (
        <text fg={theme.textMuted} wrapMode="none">
          {props.hint}
        </text>
      ) : null}
    </box>
  )
}

/**
 * The drawer's one button shape: a bordered box that lights up PRIMARY +
 * BOLD when it is the selected/focused choice. Engine chips, the after-start
 * toggle, and the linked story's Open/Unlink actions were four copies of the
 * same twenty lines; they are one component now, so a new action costs a
 * label and a handler.
 *
 * No fill on purpose: border cells share the parent box's background, so a
 * `backgroundElement` fill halos AROUND the border line. The primary border
 * plus bold text alone mark selection.
 */
export function ChipButton(props: {
  label: string
  selected: boolean
  onPress: () => void
  /** Colour when NOT selected: `muted` for a picker option (default), `text`
   *  for an action meant to stay readable while focus is elsewhere. */
  tone?: "muted" | "text"
  paddingBottom?: number
}) {
  const { theme } = useTheme()
  return (
    <box
      {...FRAME}
      borderColor={props.selected ? theme.primary : theme.borderSubtle}
      paddingLeft={2}
      paddingRight={2}
      {...(props.paddingBottom === undefined ? {} : { paddingBottom: props.paddingBottom })}
      onMouseUp={props.onPress}
    >
      <text
        fg={props.selected ? theme.primary : props.tone === "text" ? theme.text : theme.textMuted}
        attributes={props.selected ? TextAttributes.BOLD : undefined}
        wrapMode="none"
      >
        {props.label}
      </text>
    </box>
  )
}

/** Width of the age column — "999d" is the widest {@link relativeAgeMs} yield. */
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
        if (live) setRows(eventRows(result.events, Date.now(), EVENT_FEED_LIMIT))
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
      <SectionHeader label={t("kanban.detail.eventsLabel")} focused={false} />
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
