/**
 * The shortcut HUD (TUI `prefix-hud.tsx`, `shortcut-reveal.tsx`), bottom-left over the rail.
 * Armed prefix: `ctrl+a ⋯`, and after 180 ms the complete command map, grouped, each row
 * a click target. Held Ctrl: the direct shortcuts. Each resolved stroke: `ctrl+a + z →
 * Toggle zen mode` (or `∅`) for four seconds. While the prefix is armed, controls that
 * name a binding carry a keycap with its real chord (`ShortcutBadge`).
 */

import { RoveKeymap } from "@sma1lboy/rove/src/tui/context/keybindings-table.ts"
import { guideCategory } from "@sma1lboy/rove/src/tui/lib/help-groups.ts"
import {
  DIRECT_GUIDE_PREFIX_ACTION_ID,
  directGuideOptions,
  shortcutCaption,
} from "@sma1lboy/rove/src/tui/lib/shortcut-reveal.ts"
import { type CSSProperties, type ReactNode, useEffect, useState } from "react"
import { strokeText } from "./chord.ts"
import { allCommands, appliesOn, currentSurface, reachability, specificity } from "./commands.ts"
import { useLocale } from "./i18n/index.ts"
import { actionLabel, categoryName, helpText } from "./keymap-text.ts"
import type { AppModel } from "./model.ts"
import { GUIDE_DELAY_MS, HUD_TTL_MS, hud } from "./prefix-state.ts"
import { runPrefixStroke } from "./prefix.tsx"
import { usePrefs } from "./prefs.ts"
import { useStore } from "./store.ts"
import { LEAVE_MS } from "./ui.ts"
import {
  PREFIX_GUIDE,
  PREFIX_GUIDE_BODY,
  PREFIX_GUIDE_GROUP,
  PREFIX_GUIDE_HEAD,
  PREFIX_GUIDE_ROW,
  PREFIX_HUD,
  PREFIX_KEY,
  prefixHudLine,
  shortcutBadge,
} from "./ui/shell.ts"
import { prefixKey, userKeys } from "./user-keys.ts"

interface GuideOption {
  readonly stroke: string
  readonly action: string
}

/** Strokes the armed prefix would run here: the most local command wins a shared stroke (the TUI's first-seen). */
function prefixOptions(model: AppModel): GuideOption[] {
  const surface = currentSurface()
  const best = new Map<string, { action: string; rank: number }>()
  for (const command of allCommands()) {
    if (!command.prefix || !appliesOn(command, surface) || command.live?.(model) === false) continue
    const rank = specificity(command, surface)
    for (const stroke of command.chords) {
      const held = best.get(stroke)
      if (!held || rank < held.rank) best.set(stroke, { action: command.id, rank })
    }
  }
  return [...best].map(([stroke, { action }]) => ({ stroke, action }))
}

interface GuideGroup {
  readonly category: string
  readonly actions: { readonly action: string; readonly strokes: string[] }[]
}

/** Catalogue order, aliases collapsed (`p / P`), grouped by the guide's own headings. */
function groupOptions(options: readonly GuideOption[]): GuideGroup[] {
  const order = new Map(RoveKeymap.map((binding, index) => [binding.id, index]))
  const byAction = new Map<string, string[]>()
  for (const { stroke, action } of options) byAction.set(action, [...(byAction.get(action) ?? []), stroke])
  const groups = new Map<string, GuideGroup["actions"]>()
  const actions = [...byAction].sort(
    ([a], [b]) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER),
  )
  for (const [action, strokes] of actions) {
    const category = guideCategory(action)
    groups.set(category, [...(groups.get(category) ?? []), { action, strokes }])
  }
  return [...groups].map(([category, rows]) => ({ category, actions: rows }))
}

const labelOf = (action: string): string =>
  action === DIRECT_GUIDE_PREFIX_ACTION_ID ? helpText("moreCommandsPrefix") : actionLabel(action)

/** Re-render when the next timer is due: the guide's delay, then each line's expiry. */
function useDeadline(deadline: number | null): void {
  const [, tick] = useState(0)
  useEffect(() => {
    if (deadline === null) return
    const id = window.setTimeout(() => tick((n) => n + 1), Math.max(30, deadline - Date.now()))
    return () => window.clearTimeout(id)
  }, [deadline])
}

export function PrefixHud({ model }: { model: AppModel }) {
  useLocale()
  const state = useStore(hud)
  useStore(userKeys)
  useStore(model.selection)
  const now = Date.now()
  const fresh = state.entries.filter((entry) => now - entry.at < HUD_TTL_MS)
  const armedAt = state.guide?.kind === "prefix" ? state.guide.armedAt : null
  const guideDue = armedAt !== null && now - armedAt < GUIDE_DELAY_MS ? armedAt + GUIDE_DELAY_MS : null
  useDeadline(guideDue ?? (fresh[0] ? fresh[0].at + HUD_TTL_MS : null))

  const showGuide = state.guide?.kind === "direct" || (armedAt !== null && guideDue === null)
  if (!showGuide && !state.guide && fresh.length === 0) return null

  if (showGuide && state.guide) {
    const direct = state.guide.kind === "direct"
    const options = direct
      ? directGuideOptions(reachability(model, currentSurface()), prefixKey())
      : prefixOptions(model)
    return (
      <output
        className={`mono ${PREFIX_GUIDE}`}
        // The guide must not take focus from the pane the stroke is meant for.
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className={PREFIX_GUIDE_HEAD}>
          <span className="text-accent">
            {direct ? helpText("directLayer") : helpText("commandLayer", { prefix: prefixKey() ?? "" })}
          </span>
          <span className="keys-only text-muted">{direct ? helpText("releaseCtrl") : helpText("escCancel")}</span>
        </div>
        <div className={PREFIX_GUIDE_BODY}>
          {groupOptions(options).map((group) => (
            <div key={group.category} className={PREFIX_GUIDE_GROUP}>
              <div className="text-accent">{categoryName(group.category)}</div>
              {group.actions.map(({ action, strokes }) => (
                <button
                  type="button"
                  key={action}
                  className={PREFIX_GUIDE_ROW}
                  disabled={direct}
                  onClick={() => strokes[0] && runPrefixStroke(model, strokes[0])}
                >
                  <span className={PREFIX_KEY}>{strokes.map(strokeText).join("/")}</span>
                  <span>{labelOf(action)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </output>
    )
  }

  return (
    <output className={PREFIX_HUD}>
      {fresh.map((entry) => (
        <HudLine key={entry.id} at={entry.at}>
          <span className="text-accent">{prefixKey()}</span> + {entry.stroke} →{" "}
          {entry.action ? labelOf(entry.action) : <span className="text-muted">∅</span>}
        </HudLine>
      ))}
      {armedAt !== null && (
        <div className={prefixHudLine(false)}>
          <span className="text-accent">{prefixKey()}</span> ⋯
        </div>
      )}
    </output>
  )
}

/** Fades out as it expires, timed from the stroke, not the mount: the guide unmounts lines and brings them back late. */
function HudLine({ at, children }: { at: number; children: ReactNode }) {
  const [mountedAt] = useState(Date.now)
  const late = mountedAt - at > LEAVE_MS
  // Negative once inside the last LEAVE_MS: the fade starts part-way and still ends at HUD_TTL_MS.
  const out = { "--hud-out": `${at + HUD_TTL_MS - LEAVE_MS - mountedAt}ms` } as CSSProperties
  return (
    <div className={prefixHudLine(late)} style={out}>
      {children}
    </div>
  )
}

/** A keycap over a control that already names a binding, shown only while the prefix is armed (`local` mode); a click runs the binding's stroke. */
/** `head`: under the rail head, where the badge hangs below its chip. */
export function ShortcutBadge({
  model,
  bindingId,
  head = false,
}: { model: AppModel; bindingId: string; head?: boolean }) {
  const state = useStore(hud)
  useStore(userKeys)
  const mode = usePrefs().prefs.prefixTap
  if (state.guide?.kind !== "prefix" || mode !== "local") return null
  const caption = shortcutCaption({
    bindingId,
    reachability: reachability(model, currentSurface()),
    prefixKey: prefixKey(),
  })
  if (!caption) return null
  const stroke = allCommands().find((command) => command.id === bindingId && command.prefix)?.chords[0]
  return (
    <button
      type="button"
      className={`mono ${shortcutBadge(head)}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        if (stroke) runPrefixStroke(model, stroke)
      }}
    >
      {caption}
    </button>
  )
}
