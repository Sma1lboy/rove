/** @jsxImportSource @opentui/react */
/**
 * Bottom-left shortcut HUD (over the Tasks sidebar — NOT the terminal column,
 * where it collided with the engine's own status line): while the PureTUI
 * prefix is armed it shows a live `ctrl+a ⋯` line, a held Ctrl key shows the
 * direct-shortcut guide, and each resolved
 * sequence lands a `ctrl+a + t → tab.new` line (or `∅` on a miss). The last
 * three lines stream like a mini log and flush PREFIX_HUD_TTL_MS after they
 * land — flush timers live HERE; the framework-free feed only timestamps
 * (src/tui/lib/prefix-hud.ts), so headless dispatch stays timer-free.
 */

import { useTerminalDimensions } from "@opentui/react"
import { useEffect, useState } from "react"
import { charWidth, displayWidth } from "../../lib/display-width"
import { KobeKeymap, findBinding } from "../../tui/context/keybindings"
import { guideCategory } from "../../tui/lib/help-groups"
import { currentPrefixConfiguration } from "../../tui/lib/keymap-dispatch"
import { PREFIX_GUIDE_DELAY_MS, PREFIX_HUD_TTL_MS, prefixHudClock, prefixHudState } from "../../tui/lib/prefix-hud"
import { DIRECT_GUIDE_PREFIX_ACTION_ID } from "../../tui/lib/shortcut-reveal"
import { truncateEndCells } from "../../tui/lib/truncate"
import { useTheme } from "../context/theme"
import { tKeys, useT } from "../i18n"
import { invokeArmedPrefixActionFromCurrentStack } from "../lib/keymap"
import { isNarrowWidth } from "../lib/narrow-mode"
import { useAccessor } from "../lib/use-accessor"
import { FRAME } from "../ui/frame"
import { useShortcutRevealPresentation } from "./shortcut-reveal"

const BOTTOM_MARGIN = 1

/**
 * Human label for a resolved action: the KobeKeymap row's help description,
 * clipped at its `:` lead when present (`Quick-fork: create child task…` →
 * `Quick-fork`). Falls back to the raw id for rows without a description.
 */
function actionLabel(action: string, translate: ReturnType<typeof useT>): string {
  if (action === DIRECT_GUIDE_PREFIX_ACTION_ID) return translate("help.moreCommandsPrefix")
  const binding = findBinding(action)
  if (!binding) return action
  // HUD rows are cheat-sheet captions, not documentation: also clip a
  // dash-led elaboration ("New conversation — engine/shell picker with …"
  // → "New conversation"). The F1 help dialog keeps the full description.
  const label = tKeys("desc", action)
  const dash = label.search(/\s—\s|——/)
  return dash > 0 ? label.slice(0, dash) : label
}

type GuideAction = { action: string; strokes: string[] }
type GuideGroup = { category: string; actions: GuideAction[] }

/** Keep catalogue order while collapsing aliases such as p / shift+p. */
function groupPrefixGuideOptions(options: readonly { stroke: string; action: string }[]): GuideGroup[] {
  const order = new Map(KobeKeymap.map((binding, index) => [binding.id, index]))
  const byAction = new Map<string, GuideAction>()
  for (const option of options) {
    const current = byAction.get(option.action)
    if (current) current.strokes.push(option.stroke)
    else byAction.set(option.action, { action: option.action, strokes: [option.stroke] })
  }
  const groups = new Map<string, GuideAction[]>()
  const actions = [...byAction.values()].sort(
    (a, b) => (order.get(a.action) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.action) ?? Number.MAX_SAFE_INTEGER),
  )
  for (const action of actions) {
    const category = guideCategory(action.action)
    const rows = groups.get(category)
    if (rows) rows.push(action)
    else groups.set(category, [action])
  }
  return [...groups].map(([category, rows]) => ({ category, actions: rows }))
}

export function PrefixHud(props: { left: number; width: number }) {
  const { theme } = useTheme()
  const t = useT()
  const dims = useTerminalDimensions()
  const hud = useAccessor(prefixHudState)
  const guide = hud.guide
  const { activeSurface } = useShortcutRevealPresentation()
  const showPrefixGuide = guide?.kind === "prefix" && activeSurface !== null
  const showCommandGuide = guide?.kind === "direct" || showPrefixGuide
  const [, setFlushTick] = useState(0)

  // Every read of "now" and every expiry timer below goes through the HUD
  // clock, never the globals: that is the seam render tests advance so the
  // delayed reveal is deterministic instead of a race (src/tui/lib/prefix-hud).
  const clock = prefixHudClock()
  const now = clock.now()
  const fresh = hud.entries.filter((entry) => now - entry.at < PREFIX_HUD_TTL_MS)

  // Wake up when the oldest visible line crosses its TTL so it flushes out.
  const oldestAt = fresh[0]?.at
  useEffect(() => {
    if (oldestAt === undefined) return
    return clock.schedule(
      () => setFlushTick((tick) => tick + 1),
      Math.max(30, oldestAt + PREFIX_HUD_TTL_MS - clock.now()),
    )
  }, [oldestAt, clock])

  useEffect(() => {
    if (!showPrefixGuide || guide?.kind !== "prefix") return
    const remaining = guide.armedAt + PREFIX_GUIDE_DELAY_MS - clock.now()
    if (remaining <= 0) return
    return clock.schedule(() => setFlushTick((tick) => tick + 1), remaining)
  }, [showPrefixGuide, guide, clock])

  const lineCount = fresh.length + (showCommandGuide ? 1 : 0)
  if (lineCount === 0) return null
  const prefixKey = currentPrefixConfiguration().key ?? ""
  const showGuide =
    guide?.kind === "direct" ||
    (showPrefixGuide && guide?.kind === "prefix" && now - guide.armedAt >= PREFIX_GUIDE_DELAY_MS)
  const groups = showGuide && guide ? groupPrefixGuideOptions(guide.options) : []

  if (showGuide) {
    const narrow = dims.width < 88
    const columns = narrow ? 1 : Math.min(dims.width < 140 ? 2 : 3, Math.max(1, groups.length))
    const guideWidth = Math.max(20, dims.width - 4)
    const groupWidth = narrow ? guideWidth - 4 : Math.max(18, Math.floor((guideWidth - 4) / columns))
    // ONE key-cap width per group (its widest stroke), so every label in the
    // group starts at the same column instead of each row measuring its own.
    const groupKeyWidth = (group: GuideGroup): number =>
      Math.min(9, Math.max(3, ...group.actions.map((action) => displayWidth(action.strokes.join("/")))))
    const actionHeight = (group: GuideGroup, action: GuideAction): number => {
      const strokes = action.strokes.join("/")
      // Cell widths, not String.length: CJK action labels and ⌘-class chord
      // glyphs occupy 2 (or ambiguous) cells — .length under-measures them
      // and the guide's height estimate runs off the screen bottom.
      const keyWidth = groupKeyWidth(group)
      const labelWidth = Math.max(1, groupWidth - keyWidth - 1)
      const keyLines = Math.ceil(displayWidth(strokes) / keyWidth)
      const labelLines = Math.ceil(displayWidth(actionLabel(action.action, t)) / labelWidth)
      return Math.max(1, keyLines, labelLines)
    }
    const groupHeight = (group: GuideGroup): number =>
      1 + group.actions.reduce((sum, action) => sum + actionHeight(group, action), 0)
    // Order-preserving balanced columns: split the ordered group list into
    // `columns` CONTIGUOUS chunks minimizing the tallest column, then stack
    // each chunk vertically. Short groups pack under each other instead of
    // leaving the row-aligned holes the old rows-of-columns layout had.
    const heights = groups.map(groupHeight)
    const chunkHeight = (from: number, to: number): number =>
      heights.slice(from, to).reduce((sum, h) => sum + h, 0) + Math.max(0, to - from - 1)
    const partitionBounds = (count: number): number[] => {
      let best: number[] = [groups.length]
      let bestMax = Number.POSITIVE_INFINITY
      const walk = (start: number, left: number, cuts: number[], tallest: number): void => {
        if (left === 1) {
          const max = Math.max(tallest, chunkHeight(start, groups.length))
          if (max < bestMax) {
            bestMax = max
            best = [...cuts, groups.length]
          }
          return
        }
        for (let end = start + 1; end <= groups.length - left + 1; end++) {
          walk(end, left - 1, [...cuts, end], Math.max(tallest, chunkHeight(start, end)))
        }
      }
      walk(0, Math.max(1, count), [], 0)
      return best
    }
    const bounds = partitionBounds(Math.min(columns, groups.length))
    const columnChunks: GuideGroup[][] = []
    let chunkStart = 0
    for (const bound of bounds) {
      if (bound > chunkStart) columnChunks.push(groups.slice(chunkStart, bound))
      chunkStart = bound
    }
    const contentHeight =
      3 +
      columnChunks.reduce(
        (tallest, chunk) =>
          Math.max(tallest, chunk.reduce((sum, group) => sum + groupHeight(group), 0) + (chunk.length - 1)),
        0,
      )
    const maxGuideHeight = Math.max(3, dims.height - BOTTOM_MARGIN)
    const clipped = contentHeight > maxGuideHeight
    const guideHeight = Math.min(contentHeight + (clipped ? 1 : 0), maxGuideHeight)
    const top = Math.max(0, dims.height - BOTTOM_MARGIN - guideHeight)
    return (
      <box
        position="absolute"
        zIndex={2400}
        left={2}
        top={top}
        width={guideWidth}
        height={guideHeight}
        overflow="hidden"
        {...FRAME}
        borderColor={theme.borderActive}
        backgroundColor={theme.backgroundDialog}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
      >
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.primary}>
            {guide?.kind === "direct" ? t("help.directLayer") : t("help.commandLayer", { prefix: prefixKey })}
          </text>
          <text fg={theme.textMuted}>{guide?.kind === "direct" ? t("help.releaseCtrl") : t("help.escCancel")}</text>
        </box>
        <box
          flexDirection="row"
          gap={narrow ? 0 : 1}
          alignItems="flex-start"
          flexGrow={1}
          flexShrink={1}
          overflow="hidden"
        >
          {columnChunks.map((chunk) => (
            <box key={chunk.map((group) => group.category).join("-")} flexDirection="column" flexGrow={1} flexBasis={0}>
              {chunk.map((group, groupIndex) => (
                <box key={group.category} flexDirection="column" marginTop={groupIndex === 0 ? 0 : 1}>
                  <text fg={theme.accent}>{tKeys("category", group.category)}</text>
                  {group.actions.map((action) => {
                    const strokes = action.strokes.join("/")
                    return (
                      <box
                        key={action.action}
                        flexDirection="row"
                        gap={1}
                        onMouseUp={(event: { stopPropagation(): void }) => {
                          event.stopPropagation()
                          if (guide?.kind !== "prefix") return
                          const stroke = action.strokes[0]
                          if (stroke) invokeArmedPrefixActionFromCurrentStack(action.action, stroke)
                        }}
                      >
                        <box width={groupKeyWidth(group)}>
                          <text fg={theme.primary} wrapMode="char">
                            {strokes}
                          </text>
                        </box>
                        <text fg={theme.text} wrapMode="word" flexGrow={1} flexShrink={1}>
                          {actionLabel(action.action, t)}
                        </text>
                      </box>
                    )
                  })}
                </box>
              ))}
            </box>
          ))}
        </box>
        {clipped ? <text fg={theme.textMuted}>{t("help.overflow")}</text> : null}
      </box>
    )
  }

  // Narrow mode: no sidebar column to sit over — go full width just
  // above the footer, where the bottom-most covered row is the workspace
  // frame's own border, not terminal content. NOT over the footer row
  // itself: the footer paints after the pane children, so an "overlay"
  // there loses the paint order and the two texts interleave per cell.
  const narrow = isNarrowWidth(dims.width)
  const left = narrow ? 0 : props.left
  const width = narrow ? dims.width : props.width
  const top = Math.max(0, dims.height - BOTTOM_MARGIN - lineCount)

  return (
    <box position="absolute" zIndex={2400} left={left} top={top} width={width} flexDirection="column">
      {fresh.map((entry) => (
        <box key={entry.id} paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundDialog}>
          <text fg={theme.textMuted} wrapMode="none">
            {/*
              `width` is a CELL budget, so it must be spent by the cell-aware
              truncator: the code-point twin reads a Chinese label as fitting,
              returns it whole, and `wrapMode="none"` hands Yoga a hard cut with
              no ellipsis — 「打开例行任务（定时任务）」 clipped to 「打开例行任务（」,
              which reads as a complete label ending in a dangling bracket.
              Same reasoning as the height math above.
            */}
            {truncateEndCells(
              `${entry.prefixKey ? `${entry.prefixKey} + ` : ""}${entry.stroke} ${
                entry.action ? `→ ${actionLabel(entry.action, t)}` : "∅"
              }`,
              width - 2,
              charWidth,
            )}
          </text>
        </box>
      ))}
      {showCommandGuide ? (
        <box paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundDialog}>
          <text fg={theme.textMuted} wrapMode="none">
            {`${prefixKey} ⋯`}
          </text>
        </box>
      ) : null}
    </box>
  )
}
