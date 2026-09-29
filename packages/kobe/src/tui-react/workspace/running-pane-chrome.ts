/**
 * Chrome for the workspace pane while the selected task works: the border
 * breathes between the accent and a hue-turned partner, and the top edge
 * names what is running.
 */

import type { RGBA } from "@opentui/core"
import { charWidth } from "../../lib/display-width"
import { hueBreathColor, mixInk } from "../../tui/lib/breathe"
import { truncateEndCells } from "../../tui/lib/truncate"

/** Hue turn at the bottom of a breath; negative runs orange → rose → violet. */
export const PANE_BREATH_SWING_DEG = -45

const TITLE_LABEL_CELLS = 32
const UNFOCUSED_SHARE = 0.55

/** Unfocused panes keep a faint breath so focus still reads at a glance. */
export function runningPaneBorder(accent: RGBA, inactive: RGBA, focused: boolean, tick: number): RGBA {
  const ink = hueBreathColor(accent, tick, PANE_BREATH_SWING_DEG)
  return focused ? ink : mixInk(ink, inactive, UNFOCUSED_SHARE)
}

export function runningPaneTitle(label: string, word: string): string {
  return ` ${truncateEndCells(label, TITLE_LABEL_CELLS, charWidth)} · ${word} `
}
