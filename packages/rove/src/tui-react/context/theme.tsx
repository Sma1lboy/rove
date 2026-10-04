/** @jsxImportSource @opentui/react */
/**
 * React side of theming; semantics live in `src/tui/context/theme-core.ts`.
 * `useTheme().theme` is a plain resolved object (re-renders come via
 * context). Registry state is a module-level external store, so
 * `addTheme`/`listThemes` work outside any provider.
 */

import { RGBA } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react"
import { createStateCell } from "../../lib/external-store"
import {
  BUNDLED_THEMES,
  DEFAULT_THEME,
  DEFAULT_THEME_MODE,
  type FocusAccentSlot,
  type Theme,
  type ThemeJson,
  type ThemeMode,
  type ThemeModePreference,
  applyDisplayOverlay,
  resolveTheme,
  resolveThemeMode,
} from "../../tui/context/theme-core"
import { useAccessor } from "../lib/use-accessor"

export { DEFAULT_THEME } from "../../tui/context/theme-core"
export type { FocusAccentSlot, Theme, ThemeJson } from "../../tui/context/theme-core"

type State = {
  readonly themes: Record<string, ThemeJson>
  readonly active: string
  /** The user's choice; `auto` is resolved against the host in the provider. */
  readonly mode: ThemeModePreference
  readonly transparentBackground: boolean
  readonly focusAccent: FocusAccentSlot
}

const store = createStateCell<State>({
  themes: { ...BUNDLED_THEMES },
  active: DEFAULT_THEME,
  mode: DEFAULT_THEME_MODE,
  // Hosts reseed this before first render from `readPersistedUiPrefs`, whose
  // unset default is platform-aware (`defaultTransparentBackground`).
  transparentBackground: true,
  focusAccent: "primary",
})

function listThemes(): string[] {
  return Object.keys(store.get().themes)
}

export function hasTheme(name: string): boolean {
  return Boolean(store.get().themes[name])
}

export function addTheme(name: string, theme: ThemeJson): boolean {
  if (!name) return false
  if (!theme || typeof theme !== "object" || !theme.theme) return false
  store.update((s) => ({ ...s, themes: { ...s.themes, [name]: theme } }))
  return true
}

// Usable outside the provider: host-boot seeds prefs before first render (no
// flash) and applies daemon ui-prefs pushes without a hook scope.

export function selectedTheme(): string {
  return store.get().active
}

export function setTheme(name: string): boolean {
  if (!hasTheme(name)) return false
  store.update((s) => ({ ...s, active: name }))
  return true
}

export function transparentBackground(): boolean {
  return store.get().transparentBackground
}

export function setTransparentBackground(v: boolean): void {
  store.update((s) => ({ ...s, transparentBackground: v }))
}

export function focusAccent(): FocusAccentSlot {
  return store.get().focusAccent
}

export function setFocusAccent(v: FocusAccentSlot): void {
  store.update((s) => ({ ...s, focusAccent: v }))
}

export function themeMode(): ThemeModePreference {
  return store.get().mode
}

export function setThemeMode(mode: ThemeModePreference): void {
  store.update((s) => ({ ...s, mode }))
}

export type ThemeContextValue = {
  /** The resolved palette. Plain object — re-renders arrive via context. */
  theme: Theme
  selected: string
  transparentBackground: boolean
  focusAccent: FocusAccentSlot
  /** The persisted choice, `auto` included. */
  modePreference: ThemeModePreference
  /** The half actually drawn — `auto` already resolved against the host. */
  mode(): ThemeMode
  set(name: string): boolean
  setMode(mode: ThemeModePreference): void
  setTransparentBackground(v: boolean): void
  setFocusAccent(v: FocusAccentSlot): void
  preview(options: {
    themeName: string
    themeMode: ThemeModePreference
    focusAccent: FocusAccentSlot
    transparentBackground: boolean
  }): Theme
  all(): string[]
  has(name: string): boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** OSC 11 reply wait before falling back to the unguarded palette; silent terminals must not stall. */
const HOST_PALETTE_QUERY_TIMEOUT_MS = 2_000

function resolveActive(state: State, mode: ThemeMode): Theme {
  const active = state.themes[state.active]
  if (active) return resolveTheme(active, mode)
  // safety net: if active was somehow cleared, fall back to the default theme
  const fallback = state.themes[DEFAULT_THEME] ?? Object.values(state.themes)[0]
  if (!fallback) {
    // truly empty — synthesize a black theme so the renderer can stand up
    return resolveTheme({ theme: { background: "#000000", text: "#ffffff" } }, mode)
  }
  return resolveTheme(fallback, mode)
}

/**
 * The host terminal's light/dark reading. opentui asks for it at startup
 * (OSC 10/11) and again whenever the terminal reports an appearance change,
 * emitting `theme_mode` each time the answer differs; `null` until a
 * terminal answers, and forever for one that never does.
 */
function useHostThemeMode(renderer: ReturnType<typeof useRenderer> | null): ThemeMode | null {
  const [mode, setMode] = useState<ThemeMode | null>(() => renderer?.themeMode ?? null)
  useEffect(() => {
    if (!renderer) return
    const onChange = (next: ThemeMode) => setMode(next)
    renderer.on("theme_mode", onChange)
    setMode(renderer.themeMode)
    return () => {
      renderer.off("theme_mode", onChange)
    }
  }, [renderer])
  return mode
}

export function ThemeProvider(props: { children?: ReactNode; mode?: ThemeModePreference; theme?: string }) {
  // Seed during the first render, not an effect, so the first paint is right.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed-once semantics.
  useMemo(() => {
    store.update((s) => ({
      ...s,
      mode: props.mode ?? s.mode,
      active: props.theme && s.themes[props.theme] ? props.theme : s.active,
    }))
  }, [])

  const state = useAccessor(store)
  const renderer = useRenderer()
  const hostMode = useHostThemeMode(renderer)
  const mode = resolveThemeMode(state.mode, hostMode)

  // Host background for the transparent-mode contrast guard: muted ink draws
  // on a background the palette author never saw, and OSC 11 is the only
  // source. One-shot per toggle; a miss leaves the unguarded palette. Inline
  // hosts skip: their stdin is not an interactive terminal.
  const [hostBackground, setHostBackground] = useState<RGBA | null>(null)
  useEffect(() => {
    if (!state.transparentBackground) return
    if (renderer?.screenMode === "split-footer") return
    if (!renderer) return
    let cancelled = false
    renderer
      .getPalette({ timeout: HOST_PALETTE_QUERY_TIMEOUT_MS })
      .then((colors) => {
        if (cancelled || !colors.defaultBackground) return
        setHostBackground(RGBA.fromHex(colors.defaultBackground))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [renderer, state.transparentBackground])

  const theme = useMemo(
    () =>
      applyDisplayOverlay(
        resolveActive(state, mode),
        state.focusAccent,
        state.transparentBackground,
        hostBackground ?? undefined,
      ),
    [state, mode, hostBackground],
  )

  // Inline (split-footer) hosts never paint a background: a CLI command sits
  // on the shell's own.
  useEffect(() => {
    if (renderer?.screenMode === "split-footer") return
    renderer?.setBackgroundColor(theme.background ?? RGBA.fromInts(0, 0, 0))
  }, [renderer, theme])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      selected: state.active,
      transparentBackground: state.transparentBackground,
      focusAccent: state.focusAccent,
      modePreference: state.mode,
      mode: () => mode,
      set(name: string): boolean {
        if (!hasTheme(name)) return false
        store.update((s) => ({ ...s, active: name }))
        return true
      },
      setMode(next: ThemeModePreference): void {
        store.update((s) => ({ ...s, mode: next }))
      },
      setTransparentBackground(v: boolean): void {
        store.update((s) => ({ ...s, transparentBackground: v }))
      },
      setFocusAccent(v: FocusAccentSlot): void {
        store.update((s) => ({ ...s, focusAccent: v }))
      },
      preview: (options) =>
        applyDisplayOverlay(
          resolveActive({ ...state, active: options.themeName }, resolveThemeMode(options.themeMode, hostMode)),
          options.focusAccent,
          options.transparentBackground,
          hostBackground ?? undefined,
        ),
      all: listThemes,
      has: hasTheme,
    }),
    [theme, state, mode, hostMode, hostBackground],
  )

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error("Theme context must be used within a context provider")
  return value
}
