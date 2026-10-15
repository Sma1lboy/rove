/**
 * What frames the Tasks rail and the workspace: the rail's drag edge and fold control, the
 * folded strip, the narrow layout's `‹ Tasks` bar and `↩ Recent` row, and the footer's
 * clickable key hints (TUI `sidebar-resize-grip`, `collapse-button`, `collapsed-rail`,
 * `narrow-back-bar`, `StatusKeyHintBar`).
 */

import { formatChord } from "@sma1lboy/rove/src/tui/lib/chord-glyphs.ts"
import { statusHintTokens } from "@sma1lboy/rove/src/tui/lib/keyboard-hints.ts"
import { type PointerEvent, useEffect, useRef, useState } from "react"
import { currentSurface, reachability } from "./commands.ts"
import { openHelp } from "./help-view.tsx"
import { t, useLocale } from "./i18n/index.ts"
import { hintText, tasksText, workspaceText } from "./keymap-text.ts"
import { backToTasks, clampRailWidth, enterWorkspace, railFolded, railWidth } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { ShortcutBadge } from "./prefix-guide.tsx"
import { PREFIX_KEY } from "./prefix-state.ts"
import { armPrefix } from "./prefix.tsx"
import { usePrefs } from "./prefs.ts"
import { activityGlyph, groupByProject } from "./rail.ts"
import { SettingsDialog } from "./settings-view.tsx"
import { useStore } from "./store.ts"
import { dialog } from "./ui.ts"

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
    />
  )
}

/** `‹‹` folds the rail, `››` unfolds it: mouse only, as the TUI's (a chord is the owner's call). */
export function FoldButton({ folded }: { folded: boolean }) {
  useLocale()
  return (
    <button
      type="button"
      className="rail-fold-btn mono"
      title={folded ? t("layout.railUnfold") : t("layout.railFold")}
      aria-label={folded ? t("layout.railUnfold") : t("layout.railFold")}
      onClick={() => railFolded.set(!folded)}
    >
      {folded ? "››" : "‹‹"}
    </button>
  )
}

/** The fold: each task's status glyph in its state colour under its project's divider; a click opens the task. */
/** Two cells for a title: initials across words, else its first two characters (TUI `railInitials`). */
function railInitials(title: string): string {
  const words = title
    .trim()
    .split(/[\s_\-/.]+/)
    .filter(Boolean)
  if (words.length === 0) return "··"
  if (words.length === 1) return (words[0] ?? "").slice(0, 2)
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
}

export function FoldedRail({
  model,
  frame,
  selectedTaskId,
}: { model: AppModel; frame: number; selectedTaskId: string | null }) {
  const payload = useStore(model.tasks)
  const groups = groupByProject(payload?.tasks ?? [], "default")
  const { prefs } = usePrefs()
  const style = prefs.railFold
  return (
    <div className={`rail-folded-list is-${style}`}>
      {groups.map((group) => (
        <div key={group.repo} className="rail-folded-group">
          <div className="rail-folded-rule" title={group.label} />
          {group.tasks.map((task) => {
            const { glyph, tone } = activityGlyph(task.activity?.state, frame)
            return (
              <button
                type="button"
                key={task.id}
                title={task.title}
                className={`rail-folded-cell tone-${tone} ${task.id === selectedTaskId ? "is-selected" : ""}`}
                onClick={() => {
                  model.select(task.id)
                  enterWorkspace()
                }}
              >
                {style === "hairline" ? "▌" : glyph}
                {style === "initials" && <span className="rail-folded-initials">{railInitials(task.title)}</span>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Narrow layout, content panel: the way back to the list the viewport has no room to show beside it. */
export function NarrowBackBar() {
  useLocale()
  return (
    <button type="button" className="narrow-back mono" onClick={backToTasks}>
      <span className="tone-accent">{`‹ ${workspaceText("narrowBack")}`}</span>
    </button>
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
  const modal = dialog.get() !== null
  const tokens = modal ? [] : statusHintTokens(reachability(model, currentSurface()), PREFIX_KEY)
  const press = {
    commands: armPrefix,
    help: () => openHelp(model),
    sidebar: () => document.querySelector<HTMLElement>(".rail")?.focus(),
  } as const
  const items: Array<{ text: string; onPress: () => void; bindingId?: string }> = tokens.map((token) => ({
    text: narrow ? formatChord(token.chord) : hintText(`status.${token.msg}`, { key: formatChord(token.chord) }),
    onPress: press[token.msg],
  }))
  if (!narrow) {
    items.push({
      text: `[${hintText("status.settings")}]`,
      onPress: () => dialog.set(<SettingsDialog client={model.client} />),
      bindingId: "settings.open",
    })
  }
  return (
    // A hint is a click target, not a focus target: the pane keeps focus so the key it arms reaches it.
    <span className="hint-bar mono" onMouseDown={(e) => e.preventDefault()}>
      {items.map((item, i) => (
        <span key={item.text}>
          {i > 0 && <span className="hint-sep subtle">·</span>}
          <button type="button" className="link" disabled={modal} onClick={item.onPress}>
            {item.text}
          </button>
          {item.bindingId && <ShortcutBadge model={model} bindingId={item.bindingId} />}
        </span>
      ))}
    </span>
  )
}
