/**
 * Each task's own hue (the TUI's `useTaskColor`): a mark on its rail rows and the colour of the
 * working border. The hue maths is the TUI's `taskColor`, run by the bridge (`theme.taskColors`)
 * under the theme and mode in use, so the page never restates it.
 */

import { useEffect, useSyncExternalStore } from "react"
import type { AppModel } from "./model.ts"
import { type Mode, resolveMode } from "./prefs-theme.ts"
import { usePrefs } from "./prefs.ts"
import { createStore, useStore } from "./store.ts"

const colors = createStore<Readonly<Record<string, string>>>({})
/** What `colors` was computed for; a different theme or mode starts over. */
let computedFor = ""

const DARK_QUERY = "(prefers-color-scheme: dark)"

function watchScheme(listener: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY)
  query.addEventListener("change", listener)
  return () => query.removeEventListener("change", listener)
}

/** The browser's colour scheme, which `auto` follows (the TUI follows the terminal's). */
export function useSystemDark(): boolean {
  return useSyncExternalStore(watchScheme, () => window.matchMedia(DARK_QUERY).matches)
}

/** The half of the theme in use: the Mode setting, with `auto` resolved. */
export function useMode(): Mode {
  const dark = useSystemDark()
  return resolveMode(usePrefs().prefs.themeMode, dark)
}

/** Fetch colours for tasks that have none yet; no-op while the setting is off. */
export function useTaskColorFeed(model: AppModel): void {
  const mode = useMode()
  const state = usePrefs()
  useEffect(() => {
    if (!state.loaded || state.prefs.taskColors !== "on") return
    const scope = `${state.prefs.theme}/${mode}`
    if (scope !== computedFor) {
      computedFor = scope
      colors.set({})
    }
    const fetchMissing = () => {
      const have = colors.get()
      const ids = (model.tasks.get()?.tasks ?? []).map((task) => task.id).filter((id) => !(id in have))
      if (ids.length === 0) return
      void model.client
        .request<{ colors: Record<string, string> }>("theme.taskColors", {
          theme: state.prefs.theme,
          mode,
          taskIds: ids,
        })
        .then((reply) => {
          if (computedFor === scope) colors.set({ ...colors.get(), ...reply.colors })
        })
        .catch(() => undefined)
    }
    fetchMissing()
    return model.tasks.subscribe(fetchMissing)
  }, [model, mode, state.loaded, state.prefs.taskColors, state.prefs.theme])
}

/** The task's colour, or undefined when the setting is off (rows keep their theme ink). */
export function useTaskColor(taskId: string | null | undefined): string | undefined {
  const state = usePrefs()
  const all = useStore(colors)
  return taskId && state.prefs.taskColors === "on" ? all[taskId] : undefined
}
