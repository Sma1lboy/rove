/** @jsxImportSource @opentui/react */
/** Shared sidebar chrome (brand header, create row, search, nav rail, section header), so every sidebar surface renders the same thing. */

import { MouseButton, TextAttributes } from "@opentui/core"
import { useState } from "react"
import type { SidebarNav } from "../../../tui/panes/sidebar/nav-core"
import { ShortcutRevealBadge } from "../../component/shortcut-reveal"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { usePageEntries } from "../../pages/registry"
import { useHoverFill } from "../../ui/use-hover-fill"

/**
 * The web's disclosure chevron: right on a folded project, down on an open one. Both are in every
 * Latin font: U+2304 `⌄` is not, and a fallback face draws it small and off the line.
 */
export const CHEVRON_FOLDED = "›"
export const CHEVRON_OPEN = "v"

/**
 * A project's header, after the web's: its name, then a chevron (always on a folded project, under
 * the pointer on an open one), and under the pointer a `+` at the row's end that starts a task in it.
 */
export function SectionHeader(props: {
  label: string
  suffix?: string
  topPad?: boolean
  /** Set on a header that folds: whether its rows are folded away. Absent = no chevron. */
  collapsed?: boolean
  onPress?: () => void
  /** The `+`: a new task in this project. Absent = no `+`. */
  onAdd?: () => void
  /** Right-click, with the click's screen cell (the tree's project menu). */
  onContextMenu?: (x: number, y: number) => void
  /** Tree depth. Non-zero indents the header. */
  depth?: number
}) {
  const { theme } = useTheme()
  const [hovered, setHovered] = useState(false)
  const chevron = props.collapsed === undefined ? null : props.collapsed ? CHEVRON_FOLDED : hovered ? CHEVRON_OPEN : " "
  return (
    <box flexDirection="column" flexShrink={0}>
      {props.topPad ? (
        <box flexShrink={0}>
          <text wrapMode="none"> </text>
        </box>
      ) : null}
      {/* biome-ignore lint/a11y/useKeyWithMouseEvents: a terminal box takes no focus; the fold and New task have keys */}
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingLeft={1 + (props.depth ?? 0) * 2}
        paddingRight={1}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseUp={
          props.onPress || props.onContextMenu
            ? (evt: { button: number; x: number; y: number }) => {
                if (evt.button === MouseButton.RIGHT && props.onContextMenu) {
                  props.onContextMenu(evt.x, evt.y)
                  return
                }
                if (evt.button === MouseButton.LEFT) props.onPress?.()
              }
            : undefined
        }
      >
        {/* A terminal has one type size: the web's small project name is the muted ink, dimmed until the pointer is on it. */}
        <text fg={theme.textMuted} attributes={hovered ? undefined : TextAttributes.DIM} wrapMode="none" flexShrink={0}>
          {props.label}
        </text>
        {chevron ? (
          <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
            {chevron}
          </text>
        ) : null}
        <box flexGrow={1} />
        {props.suffix ? (
          <text fg={theme.info} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
            {props.suffix}
          </text>
        ) : null}
        {props.onAdd && hovered ? (
          <text
            fg={theme.text}
            wrapMode="none"
            flexShrink={0}
            onMouseUp={(evt: { button: number; stopPropagation(): void }) => {
              // Its own press: the header's would fold the project.
              evt.stopPropagation()
              if (evt.button === MouseButton.LEFT) props.onAdd?.()
            }}
          >
            +
          </text>
        ) : null}
      </box>
    </box>
  )
}

/** The `/` query row for every list surface; suffix reads `matches/total`. */
export function SidebarSearchInput(props: {
  query: string
  matchCount: number
  totalCount: number
  placeholder?: string
  /** Replaces the `matches/total` suffix. */
  status?: string
}) {
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
          {props.placeholder ?? t("tasks.search.placeholder")}
        </text>
      ) : (
        <text fg={theme.textMuted} wrapMode="none">
          {" "}
          {props.status ?? `${props.matchCount}/${props.totalCount}`}
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
    <box flexDirection="row" gap={1} flexShrink={0} paddingLeft={1} paddingRight={1} marginBottom={1}>
      {/* The web's wordmark. Brackets keep the accent; focus reads in the name going full ink. */}
      <text wrapMode="none" flexShrink={0}>
        <span fg={theme.primary}>[</span>
        <span fg={props.focused ? theme.text : theme.textMuted} attributes={TextAttributes.BOLD}>
          {" rove "}
        </span>
        <span fg={theme.primary}>]</span>
      </text>
      <box flexGrow={1} />
      {props.status ? (
        <box position="relative" flexShrink={0} onMouseUp={() => props.onStatusClick?.()}>
          <text fg={props.status.emphasize ? theme.primary : theme.textMuted} wrapMode="none">
            {props.status.label}
          </text>
          {props.onStatusClick ? <ShortcutRevealBadge bindingId="inbox.show" /> : null}
        </box>
      ) : null}
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

/** New-task row, ending in the web's `+`. Its key shows with the other shortcut badges. */
export function SidebarCreateAction(props: { onAddTask?: () => void }) {
  const { theme, transparentBackground } = useTheme()
  const t = useT()
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
        <ShortcutRevealBadge bindingId="task.new" />
      </box>
    </box>
  )
}

/** The rail's Settings row, at its foot as on the web. */
export function SidebarSettingsRow(props: { onOpenSettings: () => void }) {
  const { theme } = useTheme()
  const t = useT()
  const hover = useHoverFill()
  return (
    <box
      position="relative"
      flexShrink={0}
      backgroundColor={hover.fill}
      {...hover.handlers}
      onMouseUp={(e: { stopPropagation(): void }) => {
        e.stopPropagation()
        props.onOpenSettings()
      }}
    >
      <text fg={hover.hovered ? theme.text : theme.textMuted} wrapMode="none">
        {t("settings.title")}
      </text>
      <ShortcutRevealBadge bindingId="settings.open" />
    </box>
  )
}

/** One destination per registered page, one per line: the 24-cell rail can't fit chips side by side. */
export function SidebarNavRail(props: { nav: SidebarNav; setNav: (nav: SidebarNav) => void }) {
  // Subscribes to the UI language: page titles are read at render.
  useT()
  const pages = usePageEntries()
  if (pages.length === 0) return null
  return (
    <box flexDirection="column" flexShrink={0} paddingBottom={1}>
      {pages.map((item) => (
        <NavRow key={item.id} item={item} active={props.nav === item.id} onPick={() => props.setNav(item.id)} />
      ))}
    </box>
  )
}

function NavRow(props: { item: ReturnType<typeof usePageEntries>[number]; active: boolean; onPick: () => void }) {
  const { theme } = useTheme()
  const hover = useHoverFill()
  const { item, active } = props
  return (
    <box
      position="relative"
      flexDirection="row"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={hover.fill}
      {...hover.handlers}
      onMouseUp={(e: { stopPropagation(): void }) => {
        // A bubbled sidebar focus-grab would take focus back from the
        // page, so keys typed into it would fire sidebar chords.
        e.stopPropagation()
        props.onPick()
      }}
    >
      <text
        // Not the focus accent: it already marks focused borders and selected cards.
        fg={active || hover.hovered ? theme.text : theme.textMuted}
        attributes={active ? TextAttributes.BOLD : undefined}
        wrapMode="none"
        flexGrow={1}
      >
        {item.title()}
      </text>
      {item.action ? <ShortcutRevealBadge bindingId={item.action} /> : null}
    </box>
  )
}
