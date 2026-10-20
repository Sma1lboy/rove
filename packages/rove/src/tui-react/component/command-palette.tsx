/** @jsxImportSource @opentui/react */
import { flushSync } from "@opentui/react"
import { useState } from "react"
import { formatChord } from "../../tui/lib/chord-glyphs"
import { matchesHelpAction } from "../../tui/lib/help-groups"
import { currentPrefixConfiguration } from "../../tui/lib/keymap-dispatch"
import type { PaletteAction } from "../../tui/lib/palette-actions"
import { useTheme } from "../context/theme"
import { tKeys, useT } from "../i18n"
import { currentPaletteActions, useBindings } from "../lib/keymap"
import { useTerminalSize } from "../lib/use-terminal-size"
import { type DialogContext, useDialog, useDialogPaddingX } from "../ui/dialog"

export function CommandPalette({ actions }: { actions: readonly PaletteAction[] }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const t = useT()
  const padX = useDialogPaddingX()
  const dimensions = useTerminalSize()
  const visibleCount = Math.max(1, Math.min(10, dimensions.height - 10))
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState(0)
  const prefix = currentPrefixConfiguration().key
  const rows = actions
    .map((action) => ({
      action,
      name: tKeys("desc", action.id),
      chord: action.prefix
        ? `${prefix ? formatChord(prefix) : ""} + ${formatChord(action.key)}`
        : formatChord(action.key),
    }))
    .filter((row) =>
      matchesHelpAction(query, row.name, row.action.prefix ? `${prefix} + ${row.action.key}` : row.action.key),
    )
  const index = Math.min(selected, Math.max(0, rows.length - 1))
  const run = (action: PaletteAction) => {
    flushSync(() => dialog.clear({ refocus: false }))
    if (!action.run()) dialog.replace(() => <text fg={theme.warning}>{t("help.unavailable")}</text>)
  }
  useBindings(() => ({
    bindings: [
      { key: "up", cmd: () => setSelected(Math.max(0, index - 1)) },
      { key: "down", cmd: () => setSelected(Math.min(rows.length - 1, index + 1)) },
      {
        key: "return",
        cmd: () => {
          const row = rows[index]
          if (row) run(row.action)
        },
      },
    ],
  }))
  const start = Math.max(0, index - visibleCount + 1)
  return (
    <box paddingLeft={padX} paddingRight={padX} paddingBottom={1} gap={1}>
      <text fg={theme.accent}>{t("help.palette")}</text>
      <input
        focused
        value={query}
        placeholder={t("help.search")}
        onInput={(value: string) => {
          setQuery(value)
          setSelected(0)
        }}
      />
      <box>
        {rows.length === 0 ? (
          <text fg={theme.textMuted}>{t("help.noResults")}</text>
        ) : (
          rows.slice(start, start + visibleCount).map((row, offset) => (
            <box
              key={row.action.id}
              flexDirection="row"
              gap={2}
              backgroundColor={start + offset === index ? theme.backgroundElement : undefined}
              onMouseUp={() => run(row.action)}
            >
              <text
                fg={theme.text}
                flexGrow={1}
                flexBasis={0}
                flexShrink={1}
              >{`${start + offset === index ? "› " : "  "}${row.name}`}</text>
              <text fg={theme.primary} flexShrink={0}>
                {row.chord}
              </text>
            </box>
          ))
        )}
      </box>
      <text fg={theme.textMuted}>{t("help.run")}</text>
    </box>
  )
}

CommandPalette.show = (dialog: DialogContext): void => {
  const actions = currentPaletteActions()
  dialog.replace(() => <CommandPalette actions={actions} />)
}
