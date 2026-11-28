/**
 * Mounts the Settings knobs onto the page: reads the TUI's prefs when the bridge connects (and
 * again when the window regains focus or comes back into view, so a change made in the TUI shows up), paints the theme
 * into the `:root` tokens, mirrors the flags the stylesheet reacts to as `data-*` attributes.
 */

import { useEffect } from "react"
import { applyAppearanceTokens } from "./appearance/apply.ts"
import { loadAppearances, useActiveAppearancePack } from "./appearance/runtime.ts"
import type { AppModel } from "./model.ts"
import { useCrossTaskNotices } from "./notify.ts"
import { cssVars, paletteFor, terminalTheme, themePreview, xtermTheme } from "./prefs-theme.ts"
import { loadPrefs, usePrefs } from "./prefs.ts"
import { loadSnippets } from "./snippets.ts"
import { useStore } from "./store.ts"
import { useMode, useTaskColorFeed } from "./task-colors.ts"

const ATTRS = ["workingBorder", "runningTitle", "taskColors", "colorblind"] as const

export function usePrefsApply(model: AppModel): void {
  const { client } = model
  const state = usePrefs()
  const mode = useMode()
  const preview = useStore(themePreview)
  const pack = useActiveAppearancePack()
  useTaskColorFeed(model)
  useCrossTaskNotices(model)

  useEffect(() => {
    const load = () => {
      void loadPrefs(client).catch(() => undefined)
      void loadSnippets(client).catch(() => undefined)
      void loadAppearances(client).catch(() => undefined)
    }
    // A phone back on the tab fires visibilitychange, not always focus; the TUI may have changed a pref.
    const shown = () => document.visibilityState === "visible" && load()
    const stop = client.onOpen(load)
    window.addEventListener("focus", load)
    document.addEventListener("visibilitychange", shown)
    return () => {
      stop()
      window.removeEventListener("focus", load)
      document.removeEventListener("visibilitychange", shown)
    }
  }, [client])

  useEffect(() => {
    const root = document.documentElement
    const themeName = pack?.manifest.theme ?? state.prefs.theme
    const palette = preview ? preview[mode] : paletteFor(state.themes, themeName, mode)
    const vars = palette ? cssVars(palette, state.prefs) : {}
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
    applyAppearanceTokens(root, preview ? null : (pack?.manifest ?? null), mode, vars)
    root.style.colorScheme = mode
    for (const key of ATTRS) root.dataset[key] = String(state.prefs[key])
    terminalTheme.set(palette ? xtermTheme(palette) : null)
    // The phone browser's toolbar takes the page colour (Android reads theme-color).
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement("meta")
      meta.name = "theme-color"
      document.head.append(meta)
    }
    meta.content = getComputedStyle(document.body).backgroundColor
  }, [state, mode, preview, pack])
}
