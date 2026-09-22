import type { SplitStyle } from "../../../state/split-style"
import type { TabRowHeight } from "../../../state/tab-row-height"
import type { CollapsedRailStyle } from "../../../tui-react/panes/sidebar/collapsed-rail"
import { type FocusAccentSlot, THEME_MODE_PREFERENCES, type ThemeModePreference } from "../../context/theme-core"

export const APPEARANCE_SETTINGS = [
  "theme",
  "themeMode",
  "transparent",
  "focusAccent",
  "splitStyle",
  "railFold",
  "tabRowHeight",
] as const
export type AppearanceSetting = (typeof APPEARANCE_SETTINGS)[number]

export type AppearanceSnapshot = {
  themeName: string
  themeMode: ThemeModePreference
  transparentBackground: boolean
  focusAccent: FocusAccentSlot
  splitStyle: SplitStyle
  railFoldStyle: CollapsedRailStyle
  tabRowHeight: TabRowHeight
}
export type AppearanceChoice =
  | { kind: "theme"; value: string }
  | { kind: "themeMode"; value: ThemeModePreference }
  | { kind: "transparent"; value: boolean }
  | { kind: "focusAccent"; value: FocusAccentSlot }
  | { kind: "splitStyle"; value: SplitStyle }
  | { kind: "railFold"; value: CollapsedRailStyle }
  | { kind: "tabRowHeight"; value: TabRowHeight }

export function appearanceChoices(setting: AppearanceSetting, themes: readonly string[]): AppearanceChoice[] {
  switch (setting) {
    case "theme":
      return themes.map((value) => ({ kind: setting, value }))
    case "themeMode":
      return THEME_MODE_PREFERENCES.map((value) => ({ kind: setting, value }))
    case "transparent":
      return [false, true].map((value) => ({ kind: setting, value }))
    case "focusAccent":
      return (["primary", "success", "info"] as const).map((value) => ({ kind: setting, value }))
    case "splitStyle":
      return (["box", "line"] as const).map((value) => ({ kind: setting, value }))
    case "railFold":
      return (["digits", "glyphs", "initials", "hairline"] as const).map((value) => ({ kind: setting, value }))
    case "tabRowHeight":
      return ([1, 2] as const).map((value) => ({ kind: setting, value }))
  }
}

export function applyAppearanceChoice(current: AppearanceSnapshot, choice: AppearanceChoice): AppearanceSnapshot {
  switch (choice.kind) {
    case "theme":
      return { ...current, themeName: choice.value }
    case "themeMode":
      return { ...current, themeMode: choice.value }
    case "transparent":
      return { ...current, transparentBackground: choice.value }
    case "focusAccent":
      return { ...current, focusAccent: choice.value }
    case "splitStyle":
      return { ...current, splitStyle: choice.value }
    case "railFold":
      return { ...current, railFoldStyle: choice.value }
    case "tabRowHeight":
      return { ...current, tabRowHeight: choice.value }
  }
}

export function currentAppearanceChoice(current: AppearanceSnapshot, setting: AppearanceSetting): AppearanceChoice {
  switch (setting) {
    case "theme":
      return { kind: setting, value: current.themeName }
    case "themeMode":
      return { kind: setting, value: current.themeMode }
    case "transparent":
      return { kind: setting, value: current.transparentBackground }
    case "focusAccent":
      return { kind: setting, value: current.focusAccent }
    case "splitStyle":
      return { kind: setting, value: current.splitStyle }
    case "railFold":
      return { kind: setting, value: current.railFoldStyle }
    case "tabRowHeight":
      return { kind: setting, value: current.tabRowHeight }
  }
}
