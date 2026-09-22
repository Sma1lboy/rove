/** @jsxImportSource @opentui/react */
/** Shared sidebar chrome (brand header, create row, search, nav rail, section header, zen chip), so every sidebar surface renders the same thing. */

import { MouseButton, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { legendCap } from "../../../tui/lib/help-groups"
import { SIDEBAR_NAV_ITEMS, type SidebarNav } from "../../../tui/panes/sidebar/nav-core"
import { ShortcutRevealBadge } from "../../component/shortcut-reveal"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { dividerRule } from "../../lib/rule-divider"
import { zenChipGlyph } from "./zen-glyph"

export function SectionHeader(props: {
  label: string
  suffix?: string
  topPad?: boolean
  /** Leading glyph cell (the tree's project twisty). */
  prefix?: string
  onPress?: () => void
  /** Right-click, with the click's screen cell (the tree's project menu). */
  onContextMenu?: (x: number, y: number) => void
  /** Drop the label's BOLD — how an offline machine section reads as inactive
   *  without inventing a colour the theme does not define. */
  muted?: boolean
  /** Tree depth. Non-zero indents the header, so a project sitting under a
   *  machine header reads as belonging to it. */
  depth?: number
}) {
  const { theme, transparentBackground } = useTheme()
  const dividerColor = transparentBackground ? theme.border : theme.borderSubtle
  const dims = useTerminalDimensions()
  return (
    <box flexDirection="column" flexShrink={0}>
      {props.topPad ? (
        <box flexShrink={0}>
          <text wrapMode="none"> </text>
        </box>
      ) : null}
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingLeft={1 + (props.depth ?? 0) * 2}
        paddingRight={1}
        onMouseUp={
          props.onPress || props.onContextMenu
            ? (evt: { button: number; x: number; y: number }) => {
                if (evt.button === MouseButton.RIGHT && props.onContextMenu) {
                  props.onContextMenu(evt.x, evt.y)
                  return
                }
                props.onPress?.()
              }
            : undefined
        }
      >
        {props.prefix ? (
          <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
            {props.prefix}
          </text>
        ) : null}
        <text
          fg={theme.textMuted}
          attributes={props.muted ? undefined : TextAttributes.BOLD}
          wrapMode="none"
          flexShrink={0}
        >
          {props.label}
        </text>
        <text fg={dividerColor} wrapMode="none" flexBasis={0} flexGrow={1} flexShrink={1}>
          {dividerRule(dims.width)}
        </text>
        {props.suffix ? (
          <text fg={theme.info} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
            {props.suffix}
          </text>
        ) : null}
      </box>
    </box>
  )
}

/** The `/` query row for every list surface; suffix reads `matches/total`. */
export function SidebarSearchInput(props: { query: string; matchCount: number; totalCount: number }) {
  const { theme } = useTheme()
  const t = useT()
  return (
    <box flexDirection="row" gap={0} flexShrink={0} paddingBottom={1} paddingLeft={1}>
      <text fg={theme.info} wrapMode="none">
        /
      </text>
      <text fg={theme.text} wrapMode="none">
        {props.query}
      </text>
      <text fg={theme.info} attributes={TextAttributes.BLINK} wrapMode="none">
        █
      </text>
      {props.query.length === 0 ? (
        <text fg={theme.textMuted} wrapMode="none">
          {" "}
          {t("tasks.search.placeholder")}
        </text>
      ) : (
        <text fg={theme.textMuted} wrapMode="none">
          {" "}
          {props.matchCount}/{props.totalCount}
        </text>
      )}
    </box>
  )
}

/** Brand text + inbox status. The brand text IS the sidebar's focus signal:
 *  there is no pane frame to carry it. */
export function SidebarBrandHeader(props: {
  focused: boolean
  status: { label: string; emphasize: boolean } | null
  onStatusClick?: () => void
  /** "a newer build is on npm" chip — right-aligned, opens the update page. */
  update?: { label: string } | null
  onUpdateClick?: () => void
}) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" gap={1}>
        <text fg={props.focused ? theme.focusAccent : theme.textMuted} attributes={TextAttributes.BOLD} wrapMode="none">
          ROVE
        </text>
        {props.status ? (
          <box position="relative" onMouseUp={() => props.onStatusClick?.()}>
            <text
              fg={props.status.emphasize ? theme.warningOnHost : theme.textMuted}
              attributes={props.status.emphasize ? TextAttributes.BOLD : TextAttributes.DIM}
              wrapMode="none"
            >
              {props.status.label}
            </text>
            {props.onStatusClick ? <ShortcutRevealBadge bindingId="inbox.show" /> : null}
          </box>
        ) : null}
      </box>
      {props.update ? (
        <box position="relative" flexShrink={0} onMouseUp={() => props.onUpdateClick?.()}>
          <text fg={theme.warningOnHost} attributes={TextAttributes.BOLD} wrapMode="none">
            {props.update.label}
          </text>
          {props.onUpdateClick ? <ShortcutRevealBadge bindingId="tasks.update" /> : null}
        </box>
      ) : null}
    </box>
  )
}

/** New-task row. The keycap comes from the live keymap, so a rebound or
 *  disabled `task.new` never shows stale instructions; the gap keeps `+ n`
 *  from reading as a literal `+n` chord. */
export function SidebarCreateAction(props: { onAddTask?: () => void }) {
  const { theme, transparentBackground } = useTheme()
  const t = useT()
  const keycap = legendCap("task.new")
  if (!props.onAddTask) return null

  return (
    // Exactly one line: vertical space is this panel's scarcest resource.
    // The left inset lives only on the inner (filled) box; one here too would
    // put the label at column 2 while every other sidebar element starts at 1.
    <box flexShrink={0} paddingRight={1}>
      <box
        position="relative"
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={transparentBackground ? undefined : theme.backgroundElement}
        onMouseUp={() => props.onAddTask?.()}
      >
        <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none" flexGrow={1}>
          {t("tasks.menu.newTask")}
        </text>
        <text fg={theme.primary} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
          +
        </text>
        {keycap ? (
          <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none" flexShrink={0}>
            {keycap}
          </text>
        ) : null}
        <ShortcutRevealBadge bindingId="task.new" />
      </box>
    </box>
  )
}

/** One destination per line: the 24-cell rail can't fit three chips side by side. */
export function SidebarNavRail(props: { nav: SidebarNav; setNav: (nav: SidebarNav) => void }) {
  const { theme } = useTheme()
  const t = useT()
  return (
    <box flexDirection="column" flexShrink={0} paddingBottom={1}>
      {SIDEBAR_NAV_ITEMS.map((item) => {
        const active = props.nav === item.nav
        return (
          <box
            key={item.nav}
            position="relative"
            flexDirection="row"
            flexShrink={0}
            paddingLeft={1}
            paddingRight={1}
            onMouseUp={(e: { stopPropagation(): void }) => {
              // A bubbled sidebar focus-grab would take focus back from the
              // page, so keys typed into it would fire sidebar chords.
              e.stopPropagation()
              props.setNav(item.nav)
            }}
          >
            <text
              // Not the focus accent: it already marks focused borders and selected cards.
              fg={active ? theme.text : theme.textMuted}
              attributes={active ? TextAttributes.BOLD : undefined}
              wrapMode="none"
              flexGrow={1}
            >
              {t(item.labelKey)}
            </text>
            <ShortcutRevealBadge bindingId={item.bindingId} />
          </box>
        )
      })}
    </box>
  )
}

export function SidebarZenChip(props: { onZenClick?: () => void }) {
  const { theme } = useTheme()
  return (
    <box position="relative" flexShrink={0}>
      <text
        fg={theme.accent}
        attributes={TextAttributes.BOLD}
        wrapMode="none"
        onMouseUp={(e: { stopPropagation(): void }) => {
          // A bubbled sidebar focus-grab would exit zen via the focus guard.
          e.stopPropagation()
          props.onZenClick?.()
        }}
      >
        {`${zenChipGlyph()} ZEN`}
      </text>
      <ShortcutRevealBadge bindingId="workspace.zenToggle" />
    </box>
  )
}
