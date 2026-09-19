import type { AppearanceChoice } from "../../../tui/component/settings-dialog/appearance"
import type { useT } from "../../i18n"

export function appearanceChoiceLabel(choice: AppearanceChoice, t: ReturnType<typeof useT>): string {
  switch (choice.kind) {
    case "theme":
      return choice.value
    case "transparent":
      return t(choice.value ? "settings.appearance.enabled" : "settings.appearance.disabled")
    case "focusAccent":
      return t(`settings.general.accent${choice.value.charAt(0).toUpperCase()}${choice.value.slice(1)}`)
    case "splitStyle":
      return t(choice.value === "box" ? "settings.general.splitBox" : "settings.general.splitLine")
    case "railFold":
      return t(
        {
          digits: "settings.general.railFoldDigits",
          glyphs: "settings.general.railFoldGlyphs",
          initials: "settings.general.railFoldInitials",
          hairline: "settings.general.railFoldHairline",
        }[choice.value],
      )
    case "tabRowHeight":
      return t(choice.value === 1 ? "settings.appearance.singleRow" : "settings.appearance.doubleRow")
  }
}
