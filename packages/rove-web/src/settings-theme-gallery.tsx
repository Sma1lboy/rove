/**
 * Settings → Appearance → Theme as cards: each one a miniature window in that theme's own colours.
 * Pointing at a card (or focusing it) paints the whole page in that theme; leaving the gallery puts the
 * saved one back, and a click saves it. Below, the rove.run themes not yet installed: the same preview,
 * and a click installs one (`theme.install`, as `rove theme add`) and switches to it. Last, a Scratch
 * session whose agent is asked to write a new theme into the themes directory; it shows here on reopening.
 * Inline colours are the point here: every card shows a different theme.
 */

import { type ReactNode, useEffect, useState } from "react"
import { askAgent } from "./ask-agent.ts"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { type Mode, type PreviewTheme, themePreview } from "./prefs-theme.ts"
import { type ThemeEntry, loadPrefs, setPref } from "./prefs.ts"
import { createStore, useStore } from "./store.ts"
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

interface HostedTheme extends PreviewTheme {
  readonly installed: boolean
}

/** `theme.hosted`: the catalogue and the themes directory (`null` from a bridge that predates it). */
interface Hosted {
  readonly themes: readonly HostedTheme[]
  readonly dir: string | null
}

/** Kept for the page's life so reopening Settings draws the catalogue at once; `null` until asked. */
const hostedStore = createStore<Hosted | null>(null)

function Swatch({ theme, mode }: { theme: PreviewTheme; mode: Mode }) {
  const p = theme[mode]
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

function Card(props: { theme: PreviewTheme; mode: Mode; active: boolean; tag?: string; onClick: () => void }) {
  return (
    <Button
      variant="card"
      aria-pressed={props.active}
      className={themeCardClass(props.active)}
      onMouseEnter={() => themePreview.set(props.theme)}
      onFocus={() => themePreview.set(props.theme)}
      onClick={props.onClick}
    >
      <Swatch theme={props.theme} mode={props.mode} />
      <span className={THEME_CARD_NAME}>
        <span className="truncate text-ink">{props.theme.name}</span>
        {props.tag && <span className="text-subtle">{props.tag}</span>}
      </span>
    </Button>
  )
}

/** Leaving the grid (pointer or keyboard focus) drops the preview. */
function Grid({ children }: { children: ReactNode }) {
  return (
    <div
      className={THEME_GRID}
      onMouseLeave={() => themePreview.set(null)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) themePreview.set(null)
      }}
    >
      {children}
    </div>
  )
}

export function ThemeGallery(props: {
  model: AppModel
  label: string
  themes: readonly ThemeEntry[]
  value: string
  mode: Mode
}) {
  const { model } = props
  const { client } = model
  const hosted = useStore(hostedStore)
  const [installing, setInstalling] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [askFailed, setAskFailed] = useState(false)
  // A preview must not outlive the page: leaving Settings mid-hover would keep painting it.
  useEffect(() => () => themePreview.set(null), [])
  // A theme written under themes/ while the page kept focus (an agent's, a hand edit) shows on reopening.
  useEffect(() => void loadPrefs(client).catch(() => undefined), [client])
  useEffect(() => {
    if (hostedStore.get() !== null) return
    client.request<Hosted>("theme.hosted").then(
      (reply) => hostedStore.set(reply),
      () => hostedStore.set({ themes: [], dir: null }),
    )
  }, [client])

  const askForTheme = (dir: string) => {
    setAskFailed(false)
    askAgent(model, t("prefs.themeAgentPrompt", { dir })).catch(() => setAskFailed(true))
  }

  const dir = hosted?.dir ?? null

  const install = async (name: string) => {
    setInstalling(name)
    setFailed(null)
    try {
      await client.request("theme.install", { name })
      await loadPrefs(client)
      await setPref(client, "theme", name)
    } catch {
      setFailed(name)
    } finally {
      setInstalling(null)
    }
  }

  const installedNames = new Set(props.themes.map((th) => th.name))
  const more = (hosted?.themes ?? []).filter((th) => !installedNames.has(th.name))
  return (
    <fieldset className={PREF_FIELD}>
      <legend className={PREF_LEGEND}>{props.label}</legend>
      <p className={`${PREF_HINT} clear-both text-muted`}>{t("prefs.themePreviewHint")}</p>
      <Grid>
        {props.themes.map((theme) => (
          <Card
            key={theme.name}
            theme={theme}
            mode={props.mode}
            active={theme.name === props.value}
            tag={theme.bundled ? undefined : t("prefs.themeUser")}
            onClick={() => theme.name !== props.value && void setPref(client, "theme", theme.name)}
          />
        ))}
      </Grid>
      {more.length > 0 && (
        <>
          <p className={`${PREF_HINT} mt-2 text-muted`}>{t("prefs.themeMoreHint")}</p>
          <Grid>
            {more.map((theme) => (
              <Card
                key={theme.name}
                theme={theme}
                mode={props.mode}
                active={false}
                tag={
                  installing === theme.name
                    ? t("prefs.themeInstalling")
                    : failed === theme.name
                      ? t("prefs.themeInstallFailed")
                      : t("prefs.themeGet")
                }
                onClick={() => installing === null && void install(theme.name)}
              />
            ))}
          </Grid>
        </>
      )}
      {dir && (
        <p className={`${PREF_HINT} mt-2 text-muted`}>
          <Button onClick={() => askForTheme(dir)}>{t("prefs.themeAgent")}</Button>{" "}
          {askFailed ? t("prefs.themeAgentFailed") : t("prefs.themeAgentHint")}
        </p>
      )}
    </fieldset>
  )
}
