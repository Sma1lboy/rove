/**
 * The fill a clickable row wears under the pointer: halfway from the rail's surface to the cursor
 * row's tint, so a hovered row never reads as the cursor's. Transparent mode has no fills, so the
 * row says it with `hovered` instead (a quiet marker, a brighter label).
 */

import type { RGBA } from "@opentui/core"
import { useState } from "react"
import { mixInk } from "../../tui/lib/breathe"
import { useTheme } from "../context/theme"

export function useHoverFill(): {
  readonly hovered: boolean
  readonly fill: RGBA | undefined
  readonly handlers: { readonly onMouseOver: () => void; readonly onMouseOut: () => void }
} {
  const { theme } = useTheme()
  const [hovered, setHovered] = useState(false)
  return {
    hovered,
    fill: hovered && theme.background.a !== 0 ? mixInk(theme.backgroundElement, theme.backgroundPanel, 0.5) : undefined,
    handlers: { onMouseOver: () => setHovered(true), onMouseOut: () => setHovered(false) },
  }
}
