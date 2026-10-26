/**
 * What frames the Tasks rail and the workspace: the rail's drag edge, the top-left fold / back /
 * forward bar, the narrow layout's `‹ Tasks` bar and `↩ Recent` row, and the footer's clickable key
 * hints (TUI `sidebar-resize-grip`, `collapse-button`, `narrow-back-bar`, `StatusKeyHintBar`).
 */

import { formatChord } from "@sma1lboy/rove/src/tui/lib/chord-glyphs.ts"
import { paneHintTokens, statusHintTokens } from "@sma1lboy/rove/src/tui/lib/keyboard-hints.ts"
import { type PointerEvent, useEffect, useRef, useState } from "react"
import { currentSurface, reachability } from "./commands.ts"
import { openHelp } from "./help-view.tsx"
import { type HintPane, hintsUsed } from "./hint-state.ts"
import { t, useLocale } from "./i18n/index.ts"
import { hintText, tasksText, workspaceText } from "./keymap-text.ts"
import { backToTasks, enterWorkspace } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { type NavPlace, go, isLive, navState, step } from "./nav-history.ts"
import { PANEL_KINDS, narrowView } from "./panel-layout.ts"
import { showPanel } from "./panel-state.ts"
import { ShortcutBadge } from "./prefix-guide.tsx"
import { armPrefix } from "./prefix.tsx"
import { usePrefs } from "./prefs.ts"
import { needsPerson } from "./rail-glyphs.ts"
import { clampRailWidth, peekRail, railFolded, railPeek, railWidth } from "./rail-layout.ts"
import { SettingsDialog } from "./settings-view.tsx"
import { useStore } from "./store.ts"
import { dialog, dragLayout } from "./ui.ts"
import { prefixKey, userKeys } from "./user-keys.ts"

/** Two releases closer together than this are one double-click. */
const DOUBLE_CLICK_MS = 400

/** The rail's right edge: drag to pin a width, double-click to go back to the automatic one. */
export function RailGrip({ rail }: { rail: React.RefObject<HTMLElement | null> }) {
  useLocale()
  const drag = useRef<{ x: number; width: number; moved: boolean } | null>(null)
  const lastUp = useRef(0)
  const down = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, width: rail.current?.getBoundingClientRect().width ?? 0, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    dragLayout(true)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const from = drag.current
    if (!from || e.clientX === from.x) return
    from.moved = true
    railWidth.set(clampRailWidth(from.width + e.clientX - from.x))
  }
  const up = () => {
    const from = drag.current
    drag.current = null
    if (!from) return
    // A drag is never half of a double-click.
    if (from.moved) {
      lastUp.current = 0
      return
    }
    const now = Date.now()
    if (now - lastUp.current < DOUBLE_CLICK_MS) {
      lastUp.current = 0
      railWidth.set(null)
    } else lastUp.current = now
  }
  return (
    <div
      className="rail-grip"
      title={t("layout.railResize")}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onLostPointerCapture={() => dragLayout(false)}
    />
  )
}

/** The rail's and the side panel's toggle icon: a window with the pane's side divided off. */
export function PaneIcon({ side }: { side: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" />
      <path d={side === "left" ? "M6 2.5v11" : "M10 2.5v11"} />
    </svg>
  )
}

/**
 * Top left of the page, folded or not, as Claude Desktop's title bar: fold the rail, then back and
 * forward. It never moves, so the rail slides away from under it; folded, a dot on the fold says a
 * hidden task needs you. Mouse only, as the TUI's (a chord is the owner's call).
 */
export function RailBar({ model }: { model: AppModel }) {
  useLocale()
  const nav = useStore(navState)
  const folded = useStore(railFolded)
  const payload = useStore(model.tasks)
  const live = (place: NavPlace) => isLive(model, place)
  const fold = folded ? t("layout.railUnfold") : t("layout.railFold")
  const waiting = folded && (payload?.tasks ?? []).some(needsPerson)
  return (
    // The bar sits over a peeking rail's top: crossing it keeps the peek open rather than opening one.
    <div
      className="rail-bar"
      onMouseEnter={() => folded && railPeek.get() && peekRail(true)}
      onMouseLeave={() => folded && railPeek.get() && peekRail(false)}
    >
      <button
        type="button"
        className="rail-bar-btn"
        title={fold}
        aria-label={fold}
        onClick={() => railFolded.set(!folded)}
      >
        <PaneIcon side="left" />
        {waiting && <span className="rail-bar-dot" />}
      </button>
      <button
        type="button"
        className="rail-bar-btn"
        title={t("layout.navBack")}
        aria-label={t("layout.navBack")}
        disabled={step(nav, -1, live) < 0}
        onClick={() => go(model, -1)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3.5 5.5 8l4.5 4.5" />
        </svg>
      </button>
      <button
        type="button"
        className="rail-bar-btn"
        title={t("layout.navForward")}
        aria-label={t("layout.navForward")}
        disabled={step(nav, 1, live) < 0}
        onClick={() => go(model, 1)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      </button>
    </div>
  )
}

const NARROW_LABEL = {
  terminal: "layout.narrowTerminal",
  files: "layout.narrowFiles",
  diff: "layout.narrowDiff",
  browser: "layout.narrowBrowser",
} as const

/**
 * Narrow layout, content panel: the way back to the list the viewport has no room to show beside it.
 * In a task it also switches between the terminal and the side panel's views, the desktop's right column.
 */
export function NarrowBackBar({ taskId }: { taskId?: string }) {
  useLocale()
  const view = useStore(narrowView)
  return (
    <div className="narrow-bar">
      <button type="button" className="narrow-back mono" onClick={backToTasks}>
        <span className="tone-accent">{`‹ ${workspaceText("narrowBack")}`}</span>
      </button>
      {taskId && (
        <span className="narrow-switch mono" role="tablist">
          {(["terminal", ...PANEL_KINDS] as const).map((id) => (
            <button
              type="button"
              role="tab"
              key={id}
              aria-selected={view === id}
              onClick={() => (id === "terminal" ? narrowView.set(id) : showPanel(taskId, id))}
            >
              {t(NARROW_LABEL[id])}
            </button>
          ))}
        </span>
      )}
    </div>
  )
}

/** Narrow layout, list panel: one click back into the task the content panel was showing (TUI `RecentJumpRow`). */
export function RecentRow({ title }: { title: string }) {
  useLocale()
  return (
    <button type="button" className="row recent-row" onClick={enterWorkspace}>
      <span className="glyph tone-accent">↩</span>
      <span className="row-title">{tasksText("recentJump", { title })}</span>
    </button>
  )
}

/** Surface (and so the reachable chords) follows focus; re-read when it moves. */
function useFocusTick(): void {
  const [, tick] = useState(0)
  useEffect(() => {
    const bump = () => tick((n) => n + 1)
    window.addEventListener("focusin", bump)
    window.addEventListener("focusout", bump)
    return () => {
      window.removeEventListener("focusin", bump)
      window.removeEventListener("focusout", bump)
    }
  }, [])
}

/** The footer's key hints (`⌃ A commands · F1 help · [settings]`): live chords only, each a click target that does what its key would. */
export function StatusHints({ model, narrow }: { model: AppModel; narrow: boolean }) {
  useLocale()
  useFocusTick()
  useStore(dialog)
  useStore(model.selection)
  useStore(userKeys)
  const { prefs } = usePrefs()
  const modal = dialog.get() !== null
  const tokens = modal ? [] : statusHintTokens(reachability(model, currentSurface()), prefixKey())
  const press = {
    commands: armPrefix,
    help: () => openHelp(model),
    sidebar: () => document.querySelector<HTMLElement>(".rail")?.focus(),
  } as const
  const items: Array<{ text: string; onPress: () => void; bindingId?: string }> = tokens.map((token) => ({
    text: narrow ? formatChord(token.chord) : hintText(`status.${token.msg}`, { key: formatChord(token.chord) }),
    onPress: press[token.msg],
  }))
  // Hints off (Settings -> General): no footer key line at all, [settings] included, as the TUI.
  if (!prefs.keyHints) return null
  if (!narrow) {
    items.push({
      text: `[${hintText("status.settings")}]`,
      onPress: () => dialog.set(<SettingsDialog model={model} />),
      bindingId: "settings.open",
    })
  }
  return (
    // A hint is a click target, not a focus target: the pane keeps focus so the key it arms reaches it.
    <span className="hint-bar mono" onMouseDown={(e) => e.preventDefault()}>
      {items.map((item, i) => (
        <span key={item.text}>
          {i > 0 && <span className="hint-sep subtle">·</span>}
          <button
            type="button"
            className="link"
            disabled={modal}
            data-prefix-arm={item.onPress === armPrefix ? "" : undefined}
            onClick={item.onPress}
          >
            {item.text}
          </button>
          {item.bindingId && <ShortcutBadge model={model} bindingId={item.bindingId} />}
        </span>
      ))}
    </span>
  )
}

/** A pane's key line (TUI `PaneKeyHint`): the fuller first-use variant until its keys have been used, then its permanent short set. */
export function PaneKeyHint({ pane }: { pane: HintPane }) {
  useLocale()
  const { prefs } = usePrefs()
  const used = useStore(hintsUsed)[pane]
  if (!prefs.keyHints) return null
  const tokens = paneHintTokens(pane, used ? "always" : "firstUse")
  if (tokens.length === 0) return null
  return (
    <p className="pane-hint mono muted">
      {tokens.map((token) => `${formatChord(token.cap)} ${hintText(`pane.${token.msg}`)}`).join(" · ")}
    </p>
  )
}
