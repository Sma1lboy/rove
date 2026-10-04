import type { AppearanceChoice } from "../../../tui/component/settings-dialog/appearance"
import type { useT } from "../../i18n"

export function appearanceChoiceLabel(choice: AppearanceChoice, t: ReturnType<typeof useT>): string {
  switch (choice.kind) {
    case "theme":
      return choice.value
    case "themeMode":
      return t(
        {
          dark: "settings.appearance.modeDark",
          light: "settings.appearance.modeLight",
          auto: "settings.appearance.modeAuto",
        }[choice.value],
      )
    case "transparent":
      return t(choice.value ? "settings.appearance.enabled" : "settings.appearance.disabled")
    case "focusAccent":
      return t(`settings.general.accent${choice.value.charAt(0).toUpperCase()}${choice.value.slice(1)}`)
    case "splitStyle":
      return t(
        {
          box: "settings.general.splitBox",
          line: "settings.general.splitLine",
          rail: "settings.general.splitRail",
          rule: "settings.general.splitRule",
        }[choice.value],
      )
    case "railFold":
      return t(
        {
          glyphs: "settings.general.railFoldGlyphs",
          initials: "settings.general.railFoldInitials",
          hairline: "settings.general.railFoldHairline",
        }[choice.value],
      )
    case "tabRowHeight":
      return t(choice.value === 1 ? "settings.appearance.singleRow" : "settings.appearance.doubleRow")
    case "workingBorder":
      return t(choice.value === "flow" ? "settings.appearance.borderFlow" : "settings.appearance.borderStill")
    case "taskColors":
      return t(choice.value === "on" ? "settings.appearance.enabled" : "settings.appearance.disabled")
    case "glyphSet":
      return t(
        {
          braille: "settings.appearance.glyphsBraille",
          starburst: "settings.appearance.glyphsStarburst",
          ascii: "settings.appearance.glyphsAscii",
        }[choice.value],
      )
    case "colorblind":
      return t(choice.value === "on" ? "settings.appearance.enabled" : "settings.appearance.disabled")
    case "runningTitle":
      return t(choice.value === "shimmer" ? "settings.appearance.titleShimmer" : "settings.appearance.titleStill")
  }
}
