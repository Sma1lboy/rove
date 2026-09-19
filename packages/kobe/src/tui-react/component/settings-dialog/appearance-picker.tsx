/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core"
import { useState } from "react"
import {
  type AppearanceChoice,
  type AppearanceSetting,
  type AppearanceSnapshot,
  appearanceChoices,
  applyAppearanceChoice,
  currentAppearanceChoice,
} from "../../../tui/component/settings-dialog/appearance"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { useBindings } from "../../lib/keymap"
import { useCursorFollow } from "../../lib/use-cursor-follow"
import { useDialog, useDialogPaddingX } from "../../ui/dialog"
import { appearanceChoiceLabel } from "./appearance-labels"
import { AppearancePreview } from "./appearance-preview"
import { Row } from "./rows"

export function AppearancePicker(props: {
  setting: AppearanceSetting
  current: AppearanceSnapshot
  themes: readonly string[]
  onCommit: (choice: AppearanceChoice) => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const t = useT()
  const options = appearanceChoices(props.setting, props.themes)
  const saved = currentAppearanceChoice(props.current, props.setting)
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === saved.value),
    ),
  )
  const selected = options[cursor]
  const follow = useCursorFollow(cursor)
  function commit(choice: AppearanceChoice | undefined) {
    if (!choice) return
    props.onCommit(choice)
    dialog.pop()
  }
  function move(delta: number) {
    if (options.length) setCursor((cursor + delta + options.length) % options.length)
  }
  useBindings(() => ({
    bindings: [
      { key: "j", cmd: () => move(1) },
      { key: "down", cmd: () => move(1) },
      { key: "k", cmd: () => move(-1) },
      { key: "up", cmd: () => move(-1) },
      { key: "return", cmd: () => commit(selected) },
    ],
  }))
  return (
    <box paddingLeft={useDialogPaddingX()} paddingRight={useDialogPaddingX()} paddingBottom={1} gap={1} flexShrink={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {t("settings.general.appearance")} / {t(`settings.general.${props.setting}`)}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.pop()}>
          {t("settings.esc")}
        </text>
      </box>
      <AppearancePreview
        current={selected ? applyAppearanceChoice(props.current, selected) : props.current}
        active={props.setting}
      />
      <text fg={theme.textMuted} flexShrink={0}>
        {t("settings.appearance.chooseHint")}
      </text>
      <scrollbox ref={follow.scrollRef} flexShrink={1} maxHeight={8}>
        {options.map((option, index) => (
          <Row
            key={String(option.value)}
            cursor={cursor === index}
            rowRef={follow.rowRef(index)}
            onMouseUp={() => commit(option)}
            fg={theme.text}
            bold={option.value === saved.value}
          >
            {`${option.value === saved.value ? "(●)" : "( )"} ${appearanceChoiceLabel(option, t)}`}
          </Row>
        ))}
      </scrollbox>
    </box>
  )
}
