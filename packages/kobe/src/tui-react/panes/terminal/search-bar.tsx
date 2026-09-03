/** @jsxImportSource @opentui/react */
/**
 * The terminal pane's `/` query row. Shape deliberately matches the sidebar's
 * search row (`panes/sidebar/chrome.tsx`) — one search affordance, one look —
 * with two differences the terminal needs: the count reads POSITION
 * (`3/17`), because walking hits is the whole interaction here, and there is
 * an alternate-screen refusal the sidebar has no equivalent for.
 *
 * It positions itself as an ABSOLUTE overlay rather than being a flow child:
 * a row in the pane's flex column would take one line off the body, resize
 * xterm, and invalidate the snapshot's absolute-line epoch mid-search — the
 * same trap `Terminal.tsx` documents for the scrolled-back hint. zIndex sits
 * above that hint, which it replaces while open.
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
  // `backgroundElement`, not `backgroundPanel`: the panel slot is forced
  // alpha-0 in transparent mode, and this row sits on top of live output.
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
