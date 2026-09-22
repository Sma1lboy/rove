/**
 * Shared row-selection semantics. Pane focus belongs to the frame
 * (`focusAccent`); rows stay neutral: the cursor gets the strongest marker +
 * tint, a persistent selection stays visible after the cursor moves.
 *
 * Transparent mode: NO fill (a tint over the wallpaper reads as a patch); the
 * ▌ marker takes the focus accent instead. Detected from the theme
 * (`background` alpha is zero), so callers thread nothing.
 */

import type { Theme } from "../context/theme"

export type RowSelectionState = {
  readonly cursor: boolean
  readonly selected?: boolean
}

export function resolveRowSelectionChrome(theme: Theme, state: RowSelectionState) {
  const transparent = theme.background.a === 0
  if (state.cursor) {
    if (transparent) {
      return {
        marker: "▌" as const,
        markerColor: theme.focusAccent ?? theme.primary,
        backgroundColor: undefined,
      }
    }
    return {
      marker: "▌" as const,
      markerColor: theme.text,
      backgroundColor: theme.backgroundElement,
    }
  }
  if (state.selected) {
    return {
      marker: "▌" as const,
      markerColor: theme.borderActive,
      backgroundColor: transparent ? undefined : theme.background,
    }
  }
  return {
    marker: " " as const,
    markerColor: undefined,
    backgroundColor: undefined,
  }
}
