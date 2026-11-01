/**
 * Settings → Appearance → Theme as cards: each one a miniature window in that theme's own colours.
 * Pointing at a card (or focusing it) paints the whole page in that theme; leaving the gallery puts the
 * saved one back, and a click saves it. Inline colours are the point here: every card shows a different theme.
 */

import { useEffect } from "react"
import { t } from "./i18n/index.ts"
import type { Mode } from "./prefs-theme.ts"
import { paletteFor, themePreview } from "./prefs-theme.ts"
import type { ThemeEntry } from "./prefs.ts"
import { Button } from "./ui/button.tsx"
import {
  PREF_FIELD,
  PREF_HINT,
  PREF_LEGEND,
  THEME_CARD_NAME,
  THEME_GRID,
  THEME_SWATCH,
  THEME_SWATCH_BAR,
  THEME_SWATCH_DOT,
  THEME_SWATCH_DOTS,
  THEME_SWATCH_PANE,
  THEME_SWATCH_RAIL,
  themeCardClass,
} from "./ui/settings.ts"

function Swatch({ theme, mode }: { theme: ThemeEntry; mode: Mode }) {
  const p = paletteFor([theme], theme.name, mode)
  if (!p) return null
  const bar = (color: string | undefined, width: string) => ({ background: color, width })
  return (
    <span className={THEME_SWATCH} style={{ background: p.background, borderColor: p.border }} aria-hidden>
      <span className={THEME_SWATCH_RAIL} style={{ background: p.backgroundPanel }}>
        <span className={THEME_SWATCH_BAR} style={bar(p.primary, "70%")} />
        <span className={THEME_SWATCH_BAR} style={bar(p.textMuted, "85%")} />
        <span className={THEME_SWATCH_BAR} style={bar(p.textMuted, "55%")} />
      </span>
      <span className={THEME_SWATCH_PANE}>
        <span className={THEME_SWATCH_BAR} style={bar(p.text, "90%")} />
        <span className={THEME_SWATCH_BAR} style={bar(p.textMuted, "65%")} />
        <span className={THEME_SWATCH_BAR} style={bar(p.accent ?? p.primary, "40%")} />
        <span className={THEME_SWATCH_DOTS}>
          {[p.success, p.warning, p.error, p.info].map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: four fixed slots
            <span key={i} className={THEME_SWATCH_DOT} style={{ background: c }} />
          ))}
        </span>
      </span>
    </span>
  )
}

export function ThemeGallery(props: {
  label: string
  themes: readonly ThemeEntry[]
  value: string
  mode: Mode
  onPick: (name: string) => void
}) {
  // A preview must not outlive the page: leaving Settings mid-hover would keep painting it.
  useEffect(() => () => themePreview.set(null), [])
  return (
    <fieldset className={PREF_FIELD}>
      <legend className={PREF_LEGEND}>{props.label}</legend>
      <p className={`${PREF_HINT} clear-both text-muted`}>{t("prefs.themePreviewHint")}</p>
      <div
        className={THEME_GRID}
        onMouseLeave={() => themePreview.set(null)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) themePreview.set(null)
        }}
      >
        {props.themes.map((theme) => {
          const active = theme.name === props.value
          return (
            <Button
              variant="card"
              key={theme.name}
              aria-pressed={active}
              className={themeCardClass(active)}
              onMouseEnter={() => themePreview.set(theme.name)}
              onFocus={() => themePreview.set(theme.name)}
              onClick={() => {
                if (!active) props.onPick(theme.name)
              }}
            >
              <Swatch theme={theme} mode={props.mode} />
              <span className={THEME_CARD_NAME}>
                <span className="truncate text-ink">{theme.name}</span>
                {!theme.bundled && <span className="text-subtle">{t("prefs.themeUser")}</span>}
              </span>
            </Button>
          )
        })}
      </div>
    </fieldset>
  )
}
