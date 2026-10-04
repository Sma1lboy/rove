import { COLORBLIND_MODES, type ColorblindMode } from "../../../state/colorblind"
import { GLYPH_SET_NAMES, type GlyphSetName } from "../../../state/glyph-set"
import { RUNNING_TITLES, type RunningTitle } from "../../../state/running-title"
import { SPLIT_STYLES, type SplitStyle } from "../../../state/split-style"
import type { TabRowHeight } from "../../../state/tab-row-height"
import { TASK_COLORS, type TaskColors } from "../../../state/task-colors"
import { WORKING_BORDERS, type WorkingBorder } from "../../../state/working-border"
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
  "workingBorder",
  "taskColors",
  "glyphSet",
  "colorblind",
  "runningTitle",
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
  workingBorder: WorkingBorder
  taskColors: TaskColors
  glyphSet: GlyphSetName
  colorblind: ColorblindMode
  runningTitle: RunningTitle
}
export type AppearanceChoice =
  | { kind: "theme"; value: string }
  | { kind: "themeMode"; value: ThemeModePreference }
  | { kind: "transparent"; value: boolean }
  | { kind: "focusAccent"; value: FocusAccentSlot }
  | { kind: "splitStyle"; value: SplitStyle }
  | { kind: "railFold"; value: CollapsedRailStyle }
  | { kind: "tabRowHeight"; value: TabRowHeight }
  | { kind: "workingBorder"; value: WorkingBorder }
  | { kind: "taskColors"; value: TaskColors }
  | { kind: "glyphSet"; value: GlyphSetName }
  | { kind: "colorblind"; value: ColorblindMode }
  | { kind: "runningTitle"; value: RunningTitle }

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
      return SPLIT_STYLES.map((value) => ({ kind: setting, value }))
    case "railFold":
      return (["glyphs", "initials", "hairline"] as const).map((value) => ({ kind: setting, value }))
    case "tabRowHeight":
      return ([1, 2] as const).map((value) => ({ kind: setting, value }))
    case "workingBorder":
      return WORKING_BORDERS.map((value) => ({ kind: setting, value }))
    case "taskColors":
      return TASK_COLORS.map((value) => ({ kind: setting, value }))
    case "glyphSet":
      return GLYPH_SET_NAMES.map((value) => ({ kind: setting, value }))
    case "colorblind":
      return COLORBLIND_MODES.map((value) => ({ kind: setting, value }))
    case "runningTitle":
      return RUNNING_TITLES.map((value) => ({ kind: setting, value }))
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
    case "workingBorder":
      return { ...current, workingBorder: choice.value }
    case "taskColors":
      return { ...current, taskColors: choice.value }
    case "glyphSet":
      return { ...current, glyphSet: choice.value }
    case "colorblind":
      return { ...current, colorblind: choice.value }
    case "runningTitle":
      return { ...current, runningTitle: choice.value }
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
    case "workingBorder":
      return { kind: setting, value: current.workingBorder }
    case "taskColors":
      return { kind: setting, value: current.taskColors }
    case "glyphSet":
      return { kind: setting, value: current.glyphSet }
    case "colorblind":
      return { kind: setting, value: current.colorblind }
    case "runningTitle":
      return { kind: setting, value: current.runningTitle }
  }
}
