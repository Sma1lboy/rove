import { approxCellWidth } from "../../../lib/display-width"

// Cell measurement moved to the shared width module; re-exported so
// existing importers (tests, panes) keep compiling.
export { approxCellWidth }

// The hover TOOLTIP itself was cut with the flat sidebar's row cards
// (2026-08-30): nothing feeds a SidebarHover anymore and no renderer
// consumed one. What survives here is the placement math, reused by the
// right-click ContextMenu — same "a box of text lines pinned near the
// pointer" problem.
export const SIDEBAR_HOVER_TOOLTIP_Z_INDEX = 2750
export const SIDEBAR_HOVER_TOOLTIP_MAX_WIDTH = 72

export type SidebarHoverTooltipLine = {
  readonly text: string
  readonly bold?: boolean
  readonly dim?: boolean
}

export type SidebarHoverTooltipLayout = {
  readonly innerWidth: number
  readonly boxWidth: number
  readonly boxHeight: number
  readonly left: number
  readonly top: number
}

export function resolveSidebarHoverTooltipLayout(opts: {
  readonly hoverX: number
  readonly hoverY: number
  readonly screenWidth: number
  readonly screenHeight: number
  readonly lines: readonly SidebarHoverTooltipLine[]
  readonly maxWidth?: number
}): SidebarHoverTooltipLayout {
  const maxWidth = opts.maxWidth ?? SIDEBAR_HOVER_TOOLTIP_MAX_WIDTH
  const widest = Math.max(1, ...opts.lines.map((line) => approxCellWidth(line.text)))
  const innerWidth = Math.min(maxWidth - 4, widest)
  const boxWidth = innerWidth + 4
  const boxHeight = opts.lines.length + 2
  return {
    innerWidth,
    boxWidth,
    boxHeight,
    left: Math.max(0, Math.min(opts.hoverX + 2, opts.screenWidth - boxWidth - 1)),
    top: Math.max(0, Math.min(opts.hoverY + 1, opts.screenHeight - boxHeight - 1)),
  }
}
