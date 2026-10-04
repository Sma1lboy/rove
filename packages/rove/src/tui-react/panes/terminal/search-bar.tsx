/** @jsxImportSource @opentui/react */
/**
 * The terminal pane's `/` query row, shaped like the sidebar's, but the count
 * is POSITION (`3/17`) and it can refuse on the alternate screen.
 *
 * ABSOLUTE overlay, not a flow child: a flow row would resize xterm and
 * invalidate the snapshot's absolute-line epoch mid-search. It sits above
 * (and replaces) the scrolled-back hint.
 */

import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"

const OVERLAY = {
  position: "absolute",
  zIndex: 11,
  left: 0,
  right: 0,
  bottom: 0,
  flexDirection: "row",
  flexShrink: 0,
  paddingLeft: 1,
  paddingRight: 1,
} as const

export function TerminalSearchBar(props: {
  query: string
  /** Zero-based position of the parked hit; -1 when none is parked. */
  index: number
  matchCount: number
  unavailable: boolean
}) {
  const { theme } = useTheme()
  const t = useT()
  // `backgroundElement`: `backgroundPanel` is alpha-0 in transparent mode.
  const surface = theme.backgroundElement
  if (props.unavailable) {
    return (
      <box {...OVERLAY} backgroundColor={surface}>
        <text fg={theme.warning} wrapMode="none">
          {t("terminal.search.unavailable")}
        </text>
      </box>
    )
  }
  const status =
    props.query.length === 0
      ? t("terminal.search.placeholder")
      : props.matchCount === 0
        ? t("terminal.search.noMatches")
        : t("terminal.search.position", { index: props.index + 1, total: props.matchCount })
  return (
    <box {...OVERLAY} gap={0} backgroundColor={surface}>
      <text fg={theme.info} wrapMode="none">
        /
      </text>
      <text fg={theme.text} wrapMode="none">
        {props.query}
      </text>
      <text fg={theme.info} attributes={TextAttributes.BLINK} wrapMode="none">
        █
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {" "}
        {status}
      </text>
    </box>
  )
}
