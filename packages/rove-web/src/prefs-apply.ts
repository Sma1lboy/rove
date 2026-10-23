/**
 * Mounts the Settings knobs onto the page: reads the TUI's prefs when the bridge connects (and
 * again when the window regains focus, so a change made in the TUI shows up), paints the theme
 * into the `:root` tokens, mirrors the flags the stylesheet reacts to as `data-*` attributes,
 * and keeps zen in step with the TUI's `zen.active`.
 */

import { useEffect } from "react"
import type { AppModel } from "./model.ts"
import { useCrossTaskNotices } from "./notify.ts"
import { cssVars, paletteFor, terminalTheme, xtermTheme } from "./prefs-theme.ts"
import { loadPrefs, prefsStore, setPref, usePrefs } from "./prefs.ts"
import { useMode, useTaskColorFeed } from "./task-colors.ts"
import { zen } from "./ui.ts"

const ATTRS = ["workingBorder", "runningTitle", "taskColors", "glyphSet", "colorblind"] as const

export function usePrefsApply(model: AppModel): void {
  const { client } = model
  const state = usePrefs()
  const mode = useMode()
  useTaskColorFeed(model)
  useCrossTaskNotices(model)

  useEffect(() => {
    const load = () => void loadPrefs(client).catch(() => undefined)
    const stop = client.onOpen(load)
    window.addEventListener("focus", load)
    return () => {
      stop()
      window.removeEventListener("focus", load)
    }
  }, [client])

  useEffect(() => {
    const root = document.documentElement
    const palette = paletteFor(state.themes, state.prefs.theme, mode)
    const vars = palette ? cssVars(palette, state.prefs) : {}
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
    root.style.colorScheme = mode
    for (const key of ATTRS) root.dataset[key] = String(state.prefs[key])
    terminalTheme.set(palette ? xtermTheme(palette) : null)
  }, [state, mode])

  // Zen is the TUI's `zen.active`: it opens in the stored state and toggling it writes it back.
  useEffect(() => {
    if (state.loaded && zen.get() !== state.prefs.zen) zen.set(state.prefs.zen)
  }, [state.loaded, state.prefs.zen])
  useEffect(
    () =>
      zen.subscribe(() => {
        if (zen.get() !== prefsStore.get().prefs.zen) void setPref(client, "zen", zen.get())
      }),
    [client],
  )
}
