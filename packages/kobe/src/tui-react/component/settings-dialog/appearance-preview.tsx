/** @jsxImportSource @opentui/react */
/**
 * The Appearance group's sample.
 *
 * Every setting in that group is applied the moment it is picked, so this is
 * not a what-if: it draws the CURRENT combination, and picking a row redraws
 * it on the same frame. That is the whole point of the group existing — theme,
 * accent, transparency and split style each answered a question you could only
 * check by closing Settings and looking at the rail.
 *
 * What it shows is a miniature of the rail, because that is the surface all
 * four settings land on at once: a selected row (accent fill), a resting row
 * with its caption line, and the split glyph between panes. The strings are
 * fixed and meaningless on purpose — this is a colour sample, and a preview
 * carrying real task names would read as a second, wrong task list.
 */

import { TextAttributes } from "@opentui/core"
import type { SplitStyle } from "../../../state/split-style"
import { useTheme } from "../../context/theme"

export function AppearancePreview(props: { splitStyle: SplitStyle }) {
  const { theme, transparentBackground } = useTheme()
  // Transparent mode has no colour of its own to show: what it does is let
  // the terminal's own background through. Leaving the box unpainted IS the
  // sample — the panel colour behind it is what the opaque setting adds.
  const ground = transparentBackground ? undefined : theme.backgroundPanel
  const divider = props.splitStyle === "box" ? "├────────────" : " ────────────"
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      // A fixed 30 cells, not a share of the panel: this is a miniature of
      // the RAIL, and a sample stretched to the settings width stops looking
      // like the thing it samples. Close to the rail's own default width.
      width={30}
      alignSelf="flex-start"
      paddingLeft={1}
      paddingRight={1}
      border
      borderColor={theme.border}
      {...(ground ? { backgroundColor: ground } : {})}
    >
      {/* The selected row — the one place focusAccent is visible. */}
      <box flexDirection="row" backgroundColor={theme.focusAccent}>
        <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD} wrapMode="none">
          {"▸ task one          ●"}
        </text>
      </box>
      <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
        {"    opus · high"}
      </text>
      <box flexDirection="row">
        <text fg={theme.text} wrapMode="none">
          {"  task two          "}
        </text>
        <text fg={theme.success} wrapMode="none">
          {"✓"}
        </text>
      </box>
      <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
        {"    engine default"}
      </text>
      {/* The split glyph, the one setting that is about the gap between panes
          rather than about a colour. */}
      <text fg={theme.border} wrapMode="none">
        {divider}
      </text>
    </box>
  )
}
