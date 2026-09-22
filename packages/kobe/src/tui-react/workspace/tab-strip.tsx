/** @jsxImportSource @opentui/react */
/**
 * Tab row above the embedded terminal. Owns the turn chip and the
 * running→done pulse (chip and title flash for a few frames as a landing cue).
 * Engines whose visible OSC title already shows activity omit the chip.
 * `tabTitle` is re-exported for `TerminalTabs.tsx`'s non-render uses (rename
 * prefill, notification titles).
 */

import { type BoxRenderable, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import type { ChatTabTurnState } from "../../engine/turn-detector"
import { approxCharCells, displayWidth } from "../../lib/display-width"
import {
  TAB_STRIP_HIDE_SINGLE_KEY,
  TAB_STRIP_MODE_KEY,
  resolveTabStripMode,
  tabStripVisible,
} from "../../state/tab-strip"
import { truncateEndCells } from "../../tui/lib/truncate"
import { DONE_PULSE_MS } from "../../tui/panes/sidebar/row-view"
import { type TerminalTab, tabTitle, visibleNativeStatus } from "../../tui/workspace/terminal-tabs-core"
import type { VendorId } from "../../types/vendor"
import { useKV } from "../context/kv"
import { type Theme, useTheme } from "../context/theme"
import { isNarrowWidth } from "../lib/narrow-mode"

export { tabTitle }

/** Turn-state glyphs mirrored on the tab strip. */
export const TURN_GLYPHS: Record<ChatTabTurnState, string> = {
  running: "●",
  done: "✓",
  error: "!",
  // Same glyphs as the sidebar rail (row-view.ts): `◷` a limit that clears
  // itself, `†` a gone engine process. Distinct because they demand opposite actions.
  rate_limited: "◷",
  dead: "†",
  // Hook-only "blocked on the user", paired like the sidebar's
  // permission_needed badge. `unknown` is never rendered, so no collision.
  needs_input: "?",
  unknown: "?",
  idle: "○",
}

/**
 * Semantic activity color, never `focusAccent`: several tabs can run at once
 * and the focus orange means only "you are here".
 */
function turnColor(theme: Theme, turn: ChatTabTurnState) {
  switch (turn) {
    case "running":
      return theme.info
    case "done":
      return theme.success
    case "error":
    case "dead":
      return theme.error
    case "needs_input":
    case "rate_limited":
      return theme.warning
    default:
      return theme.textMuted
  }
}

/** 2 cells of frame + 2 of padding + the strip's 1-cell left padding. */
const TAB_CHROME_CELLS = 5
/** Enough of a name to tell two tabs apart, plus the ellipsis. */
const MIN_TAB_TITLE_CELLS = 6

/** Active tab: three sides, so the missing bottom edge reads as a notch. */
const ACTIVE_TAB_SIDES: ("top" | "left" | "right")[] = ["top", "left", "right"]

export function TabStrip(props: {
  tabs: readonly TerminalTab[]
  activeId: string
  turnStates: ReadonlyMap<string, ChatTabTurnState>
  onSelect: (tabId: string) => void
  /** Task-level engine — the default-name fallback for unpinned tabs. */
  vendor: VendorId
  /** tabId → live process display name (see `useTurnPolls().liveTitles`). */
  liveTitles: ReadonlyMap<string, string>
  /** tabId → resolved live engine identity (see `useTurnPolls().turnVendors`). */
  turnVendors: ReadonlyMap<string, VendorId>
  /**
   * Tabs whose CURRENT completion was seen (the durable record the sidebar
   * lamp reads); their `done` chip rests at `○`. Omitted = nothing seen.
   */
  seenTabs?: ReadonlySet<string>
}) {
  const themeCtx = useTheme()
  const { theme } = themeCtx
  const kv = useKV()
  const dims = useTerminalDimensions()
  // Off by default: the sidebar tree already lists every worktree's tabs.
  // Late bail so hooks run in the same order.
  const stripMode = resolveTabStripMode(
    kv.get(TAB_STRIP_MODE_KEY, undefined),
    kv.get(TAB_STRIP_HIDE_SINGLE_KEY, undefined),
  )
  // Narrow mode overrides the setting: the sidebar tree isn't on screen there.
  const narrow = isNarrowWidth(dims.width)
  const hidden = !narrow && !tabStripVisible(stripMode, props.tabs.length)

  /* Pulse: a running→done tab id sits in `pulsing` for DONE_PULSE_MS. The
   * effect re-runs per turnStates identity (the caller always writes a new Map). */
  const prevTurns = useRef(new Map<string, ChatTabTurnState>())
  const [pulsing, setPulsing] = useState<ReadonlySet<string>>(new Set())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    for (const [tabId, turn] of props.turnStates) {
      const prev = prevTurns.current.get(tabId)
      prevTurns.current.set(tabId, turn)
      if (turn !== "done" || prev !== "running") continue
      setPulsing((cur) => new Set(cur).add(tabId))
      const timer = setTimeout(() => {
        timers.current.delete(timer)
        setPulsing((cur) => {
          const next = new Set(cur)
          next.delete(tabId)
          return next
        })
      }, DONE_PULSE_MS)
      timers.current.add(timer)
    }
    for (const id of [...prevTurns.current.keys()]) if (!props.turnStates.has(id)) prevTurns.current.delete(id)
  }, [props.turnStates])
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending) clearTimeout(timer)
    }
  }, [])

  /* Overflow: the strip is a one-row viewport (outer box clips, negative
   * marginLeft scrolls) so many tabs don't overdraw the pane's right border.
   * Scrolls per cell, only as far as keeps the ACTIVE tab fully visible.
   * Widths use display-width so CJK counts 2 cells. */
  const entries = props.tabs.map((tab) => {
    const raw = props.turnStates.get(tab.id) ?? "idle"
    // Seen means consumed (docs/TUI.md); the ACTIVE tab is exempt.
    const turn: ChatTabTurnState =
      raw === "done" && tab.id !== props.activeId && props.seenTabs?.has(tab.id) === true ? "idle" : raw
    const liveTitle = props.liveTitles.get(tab.id)
    const nativeStatusVisible = visibleNativeStatus(tab, props.vendor, props.turnVendors.get(tab.id), liveTitle)
    const chipShown = !nativeStatusVisible && turn !== "unknown" && props.turnStates.has(tab.id)
    // Cap a tab at its pane: the box clips, so a long name would be cut with
    // no ellipsis. Truncate BEFORE `cells` so the scroll math measures what's drawn.
    const title = truncateEndCells(
      tabTitle(tab, props.vendor, liveTitle),
      Math.max(MIN_TAB_TITLE_CELLS, dims.width - TAB_CHROME_CELLS - (chipShown ? 2 : 0)),
      approxCharCells,
    )
    // 2 frame + 2 padding; the scroll math must see the drawn width.
    return { tab, turn, chipShown, title, cells: 4 + (chipShown ? 2 : 0) + displayWidth(title) }
  })
  const stripRef = useRef<BoxRenderable | null>(null)
  // Strip width minus the 1-cell left padding; 0 until first layout.
  const [availCells, setAvailCells] = useState(0)
  const offsetRef = useRef(0)
  let activeStart = 0
  let activeEnd = 0
  let total = 0
  for (const entry of entries) {
    if (entry.tab.id === props.activeId) {
      activeStart = total
      activeEnd = total + entry.cells
    }
    total += entry.cells // tabs sit flush; their frames are the gutter
  }
  let offset = offsetRef.current
  if (availCells > 0) {
    if (activeEnd - offset > availCells) offset = activeEnd - availCells
    if (activeStart < offset) offset = activeStart
    offset = Math.max(0, Math.min(offset, Math.max(0, total - availCells)))
  } else {
    offset = 0
  }
  offsetRef.current = offset

  if (hidden) return null

  /* Narrow (phone-SSH) form: only the ACTIVE tab plus a right-stuck `2/3`
   * counter, which is what tells you the others exist. */
  if (narrow) {
    const activeIndex = Math.max(
      0,
      entries.findIndex((entry) => entry.tab.id === props.activeId),
    )
    const active = entries[activeIndex]
    if (!active) return null
    const counter = `${activeIndex + 1}/${entries.length}`
    // Strip padding 2 + chip padding 2 + glyph 2 (if shown) + gap 1 + counter.
    const titleCells = Math.max(4, dims.width - 5 - (active.chipShown ? 2 : 0) - counter.length)
    const pulse = pulsing.has(active.tab.id)
    return (
      // No row background: transparent mode forces panel backgrounds to alpha-0
      // (applyDisplayOverlay); only the active tab's fill paints.
      <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1} gap={1} overflow="hidden">
        {/* Chip OUTSIDE the fill, for the reason the wide branch dropped its
            own fill: on `focusAccent` the error red lands at a 1.02 contrast
            ratio, so every tone collapses into the orange. On the ambient
            surface all seven states stay tellable apart. */}
        {active.chipShown ? (
          <text fg={turnColor(theme, active.turn)} attributes={pulse ? TextAttributes.BOLD : undefined} wrapMode="none">
            {TURN_GLYPHS[active.turn]}
          </text>
        ) : null}
        <box flexDirection="row" flexShrink={1} paddingLeft={1} paddingRight={1} backgroundColor={theme.focusAccent}>
          <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD} wrapMode="none">
            {truncateEndCells(active.title, titleCells, approxCharCells)}
          </text>
        </box>
        <box flexGrow={1} />
        <text fg={theme.textMuted} wrapMode="none">
          {counter}
        </text>
      </box>
    )
  }

  return (
    <box
      ref={(r: BoxRenderable | null) => {
        stripRef.current = r
      }}
      flexDirection="row"
      flexShrink={0}
      paddingLeft={1}
      overflow="hidden"
      onSizeChange={() => setAvailCells(Math.max(0, (stripRef.current?.width ?? 0) - 1))}
    >
      <box flexDirection="row" gap={0} flexShrink={0} marginLeft={-offset}>
        {entries.map(({ tab, turn, chipShown, title }) => {
          const pulse = pulsing.has(tab.id)
          const active = tab.id === props.activeId
          return (
            <box
              key={tab.id}
              flexDirection="row"
              gap={0}
              flexShrink={0}
              paddingLeft={1}
              paddingRight={1}
              // Notch: the ACTIVE tab omits its bottom edge, opening into its
              // pane (claude-squad's `activeTabBorder`).
              border={active ? ACTIVE_TAB_SIDES : true}
              borderStyle="rounded"
              borderColor={active ? theme.focusAccent : theme.borderActive}
              onMouseUp={() => props.onSelect(tab.id)}
            >
              {/* Turn chip — tmux CHAT_TAB_STATUS_FORMAT's ●/✓/!/?/○. Shown
                  only once the turn detector has an actionable reading for the
                  tab. We deliberately skip absent and "unknown" readings: both
                  are placeholders with no information, so let the real state
                  (or the engine's native title) speak. Hidden while an
                  engine-owned live title is visibly carrying the same status.
                  No fill behind the chip anymore — the active tab is an open
                  frame, so tone colors survive on every tab. */}
              {chipShown ? (
                <text fg={turnColor(theme, turn)} attributes={pulse ? TextAttributes.BOLD : undefined} wrapMode="none">
                  {`${TURN_GLYPHS[turn]} `}
                </text>
              ) : null}
              <text
                fg={active ? theme.text : pulse ? theme.success : theme.textMuted}
                attributes={pulse || active ? TextAttributes.BOLD : undefined}
                wrapMode="none"
              >
                {title}
              </text>
            </box>
          )
        })}
      </box>
    </box>
  )
}
