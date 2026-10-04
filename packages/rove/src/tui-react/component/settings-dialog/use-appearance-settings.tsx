/** @jsxImportSource @opentui/react */
import type {
  AppearanceChoice,
  AppearanceSetting,
  AppearanceSnapshot,
} from "../../../tui/component/settings-dialog/appearance"
import type { KVContext } from "../../context/kv"
import { useTheme } from "../../context/theme"
import type { DialogContext } from "../../ui/dialog"
import { AppearancePicker } from "./appearance-picker"
import type { SettingsPrefs } from "./use-settings-prefs"

export function useAppearanceSettings(kv: KVContext, dialog: DialogContext, prefs: SettingsPrefs) {
  const theme = useTheme()
  const current: AppearanceSnapshot = {
    themeName: theme.selected,
    themeMode: theme.modePreference,
    transparentBackground: theme.transparentBackground,
    focusAccent: theme.focusAccent,
    splitStyle: prefs.splitStyle(),
    railFoldStyle: prefs.railFoldStyle(),
    tabRowHeight: prefs.tabRowHeight(),
    workingBorder: prefs.workingBorder(),
    taskColors: prefs.taskColors(),
    glyphSet: prefs.glyphSet(),
    colorblind: prefs.colorblind(),
    runningTitle: prefs.runningTitle(),
  }
  function commit(choice: AppearanceChoice): void {
    switch (choice.kind) {
      case "theme":
        if (theme.set(choice.value)) kv.set("activeTheme", choice.value)
        break
      case "themeMode":
        theme.setMode(choice.value)
        kv.set("themeMode", choice.value)
        break
      case "transparent":
        theme.setTransparentBackground(choice.value)
        kv.set("transparentBackground", choice.value)
        break
      case "focusAccent":
        theme.setFocusAccent(choice.value)
        kv.set("focusAccent", choice.value)
        break
      case "splitStyle":
        prefs.selectSplitStyle(choice.value)
        break
      case "railFold":
        prefs.selectRailFoldStyle(choice.value)
        break
      case "tabRowHeight":
        prefs.selectTabRowHeight(choice.value)
        break
      case "workingBorder":
        prefs.selectWorkingBorder(choice.value)
        break
      case "taskColors":
        prefs.selectTaskColors(choice.value)
        break
      case "glyphSet":
        prefs.selectGlyphSet(choice.value)
        break
      case "colorblind":
        prefs.selectColorblind(choice.value)
        break
      case "runningTitle":
        prefs.selectRunningTitle(choice.value)
        break
    }
  }
  function open(setting: AppearanceSetting): void {
    dialog.setSize("xlarge")
    dialog.push(() => (
      <AppearancePicker setting={setting} current={current} themes={theme.all().slice().sort()} onCommit={commit} />
    ))
  }
  return { current, open }
}
export type AppearanceSettings = ReturnType<typeof useAppearanceSettings>
