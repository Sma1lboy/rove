/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core"
import { APPEARANCE_SETTINGS, currentAppearanceChoice } from "../../../tui/component/settings-dialog/appearance"
import type { SettingsRow } from "../../../tui/component/settings-dialog/model"
import { rowIndex } from "../../../tui/component/settings-dialog/model"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { appearanceChoiceLabel } from "./appearance-labels"
import { AppearancePreview } from "./appearance-preview"
import { Row, type SectionCursorProps } from "./rows"
import type { AppearanceSettings } from "./use-appearance-settings"

export function AppearanceSettingsSection(
  props: SectionCursorProps & { appearance: AppearanceSettings; rows: SettingsRow[] },
) {
  const { theme } = useTheme()
  const t = useT()
  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {t("settings.general.appearance")}
      </text>
      <AppearancePreview current={props.appearance.current} />
      <text fg={theme.textMuted}>{t("settings.appearance.openHint")}</text>
      <box flexDirection="column">
        {APPEARANCE_SETTINGS.map((setting) => {
          const index = rowIndex(props.rows, `appearance:${setting}`)
          return (
            <Row
              key={setting}
              cursor={props.level === "body" && props.bodyRow === index}
              rowRef={props.rowRef(index)}
              onMouseUp={() => {
                props.setLevel("body")
                props.setBodyRow(index)
                props.appearance.open(setting)
              }}
              fg={theme.text}
            >
              {`${t(`settings.general.${setting}`)}: ${appearanceChoiceLabel(currentAppearanceChoice(props.appearance.current, setting), t)} ›`}
            </Row>
          )
        })}
      </box>
    </box>
  )
}
