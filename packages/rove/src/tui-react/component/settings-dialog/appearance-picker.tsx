/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core"
import {
  type AppearanceChoice,
  type AppearanceSetting,
  type AppearanceSnapshot,
  appearanceChoices,
  applyAppearanceChoice,
  currentAppearanceChoice,
} from "@sma1lboy/rove-client/settings/appearance.ts"
import type { DetectedTerminalTheme } from "@sma1lboy/rove-core/theme/terminal-detect.ts"
import { useState } from "react"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { useBindings } from "../../lib/keymap"
import { useCursorFollow } from "../../lib/use-cursor-follow"
import { useDialog, useDialogPaddingX } from "../../ui/dialog"
import { appearanceChoiceLabel } from "./appearance-labels"
import { AppearancePreview } from "./appearance-preview"
import { Row } from "./rows"

type PickerItem =
  | { readonly kind: "choice"; readonly key: string; readonly choice: AppearanceChoice }
  | { readonly kind: "import"; readonly key: string; readonly detected: DetectedTerminalTheme }

export function AppearancePicker(props: {
  setting: AppearanceSetting
  current: AppearanceSnapshot
  themes: readonly string[]
  terminalImports?: readonly DetectedTerminalTheme[]
  onCommit: (choice: AppearanceChoice) => void
  onImportTerminal?: (detected: DetectedTerminalTheme) => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const t = useT()
  const options = appearanceChoices(props.setting, props.themes)
  const saved = currentAppearanceChoice(props.current, props.setting)
  const items: PickerItem[] = [
    ...options.map((choice) => ({ kind: "choice" as const, key: `choice:${String(choice.value)}`, choice })),
    ...(props.setting === "theme" && props.terminalImports
      ? props.terminalImports.map((detected) => ({
          kind: "import" as const,
          key: `import:${detected.id}`,
          detected,
        }))
      : []),
  ]
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === saved.value),
    ),
  )
  const selected = items[cursor]
  const follow = useCursorFollow(cursor)
  function activate(item: PickerItem | undefined) {
    if (!item) return
    if (item.kind === "choice") props.onCommit(item.choice)
    else props.onImportTerminal?.(item.detected)
    dialog.pop()
  }
  function move(delta: number) {
    if (items.length) setCursor((cursor + delta + items.length) % items.length)
  }
  useBindings(() => ({
    bindings: [
      { key: "j", cmd: () => move(1) },
      { key: "down", cmd: () => move(1) },
      { key: "k", cmd: () => move(-1) },
      { key: "up", cmd: () => move(-1) },
      { key: "return", cmd: () => activate(selected) },
    ],
  }))
  const previewCurrent =
    selected?.kind === "choice"
      ? applyAppearanceChoice(props.current, selected.choice)
      : selected?.kind === "import"
        ? { ...props.current, themeName: selected.detected.label }
        : props.current
  const previewOverride = selected?.kind === "import" ? selected.detected.theme : undefined
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
      <AppearancePreview current={previewCurrent} active={props.setting} themeOverride={previewOverride} />
      <text fg={theme.textMuted} flexShrink={0}>
        {t("settings.appearance.chooseHint")}
      </text>
      <scrollbox ref={follow.scrollRef} flexShrink={1} maxHeight={8}>
        {items.map((item, index) => {
          if (item.kind === "choice") {
            const option = item.choice
            return (
              <Row
                key={item.key}
                cursor={cursor === index}
                rowRef={follow.rowRef(index)}
                onMouseUp={() => activate(item)}
                fg={theme.text}
                bold={option.value === saved.value}
              >
                {`${option.value === saved.value ? "(●)" : "( )"} ${appearanceChoiceLabel(option, t)}`}
              </Row>
            )
          }
          const alreadyInstalled = props.themes.includes(item.detected.themeName)
          const label = t(
            alreadyInstalled ? "settings.appearance.syncFromTerminal" : "settings.appearance.importFromTerminal",
            { terminal: item.detected.label },
          )
          return (
            <Row
              key={item.key}
              cursor={cursor === index}
              rowRef={follow.rowRef(index)}
              onMouseUp={() => activate(item)}
              fg={theme.accent}
            >
              {`↓ ${label}`}
            </Row>
          )
        })}
      </scrollbox>
    </box>
  )
}
