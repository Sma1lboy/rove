import { approxCharCells } from "../../../lib/display-width"
import { truncateEndCells } from "../../lib/truncate"

/**
 * Truncate a title to a cell budget, keeping the prefix. `approxCharCells`
 * because callers size `max` with `approxCellWidth` — measure and spend the
 * same way, or a CJK label overdraws its box.
 */
export function truncateTitle(title: string, max: number): string {
  return truncateEndCells(title, max, approxCharCells)
}

/**
 * Render the primary row label with a non-shrinkable spacer after the glyph.
 * Yoga may compress flex `gap` under a narrow tmux pane; making the spacer part
 * of the text keeps `○ repo` / `⠹ task` visually consistent at every width.
 */
export function spacedTitle(title: string, max: number): string {
  return ` ${truncateTitle(title, Math.max(0, max))}`
}
