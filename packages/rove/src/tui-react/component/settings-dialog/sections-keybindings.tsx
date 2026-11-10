/** @jsxImportSource @opentui/react */
/**
 * Settings → Keybindings: every rebindable binding as a row. `enter` records a new chord,
 * `backspace` restores the default, `x` unbinds; each change is saved to
 * `~/.rove/settings/keybindings.yaml` and applies at once. Load warnings sit above the list, where
 * they show without scrolling past it.
 */

import { TextAttributes } from "@opentui/core"
import { tildify } from "../../../lib/path-home"
import {
  editableBindings,
  keybindingRowId,
  keybindingRows,
  prefixTapPresentationRowId,
  rowIndex,
} from "../../../tui/component/settings-dialog/model"
import { findBinding } from "../../../tui/context/keybindings"
import { userKeybindingsReport } from "../../../tui/context/keybindings-user"
import { tKeys } from "../../../tui/i18n"
import { groupBindings } from "../../../tui/lib/help-groups"
import { currentPrefixConfiguration } from "../../../tui/lib/keymap-dispatch"
import { FIXED_BINDING_IDS, recordSlotLabels } from "../../../tui/lib/keymap-overrides"
import { PREFIX_TAP_PRESENTATIONS } from "../../../tui/lib/prefix-tap-presentation"
import { useKeymapVersion } from "../../context/keybindings"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { Row, type SectionCursorProps } from "./rows"
import type { KeybindingEditor } from "./use-keybinding-editor"
import type { SettingsPrefs } from "./use-settings-prefs"

const DESCRIPTION_WIDTH = 52
const clip = (text: string): string =>
  text.length > DESCRIPTION_WIDTH ? `${text.slice(0, DESCRIPTION_WIDTH - 1)}…` : text

export function KeybindingsSettingsSection(
  props: SectionCursorProps & {
    editor: KeybindingEditor
    prefs: SettingsPrefs
  },
) {
  const { theme } = useTheme()
  const t = useT()
  // Re-read on live keymap reload so an open page stays truthful after a YAML edit.
  useKeymapVersion()
  const report = userKeybindingsReport()
  const rows = keybindingRows(report.exists)
  const prefix = currentPrefixConfiguration()
  const prefixName = prefix.key ?? t("settings.keybindings.prefixDisabled")
  const fixedIds = Object.keys(FIXED_BINDING_IDS).sort()
  const { recording, notice } = props.editor
  const select = (row: number, run: () => void) => () => {
    props.setLevel("body")
    props.setBodyRow(row)
    run()
  }

  /** The live chords of a binding as one line, the prefix stroke spelled after the prefix key. */
  const chordsOf = (id: string): string => {
    const live = findBinding(id)
    const parts = [...(live?.keys ?? []), ...(live?.prefixKeys ?? []).map((stroke) => `${prefixName} ${stroke}`)]
    return parts.length > 0 ? parts.join(" / ") : t("settings.keybindings.unbound")
  }
  const recordingText = (id: string): string => {
    if (recording?.prefixArmed) return t("settings.keybindings.recordingPrefix", { prefix: prefixName })
    const label = recordSlotLabels(id)[recording?.got.length ?? 0]
    return label ? t("settings.keybindings.recordingSlot", { slot: label }) : t("settings.keybindings.recording")
  }

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {t("settings.keybindings.title")}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {t("settings.keybindings.hint")}
      </text>
      <box flexDirection="column" gap={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {t("settings.keybindings.configFile")}
        </text>
        {/* Tildified: the raw path wrapped onto a second line, which read as
            two facts instead of one. */}
        <text fg={theme.textMuted} wrapMode="word">
          {tildify(report.path) + (report.exists ? "" : t("settings.keybindings.notCreated"))}
        </text>
      </box>
      <box flexDirection="column" gap={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {t("settings.keybindings.tapPresentation")}
        </text>
        <text fg={theme.textMuted} wrapMode="word">
          {t("settings.keybindings.tapPresentationHint")}
        </text>
        {PREFIX_TAP_PRESENTATIONS.map((presentation) => {
          const row = rowIndex(rows, prefixTapPresentationRowId(presentation))
          const selected = props.prefs.prefixTapPresentation() === presentation
          return (
            <Row
              key={presentation}
              cursor={props.level === "body" && props.bodyRow === row}
              rowRef={props.rowRef(row)}
              onMouseUp={select(row, () => props.prefs.selectPrefixTapPresentation(presentation))}
              fg={selected ? theme.accent : theme.text}
              bold={selected || (props.level === "body" && props.bodyRow === row)}
            >
              {`${selected ? "(●)" : "( )"} ${t(
                presentation === "local"
                  ? "settings.keybindings.tapPresentationLocal"
                  : "settings.keybindings.tapPresentationGuide",
              )}`}
            </Row>
          )
        })}
      </box>
      <box flexDirection="column" gap={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {t("settings.keybindings.prefixTitle", { prefix: prefixName })}
        </text>
        <text fg={theme.textMuted} wrapMode="word">
          {t("settings.keybindings.prefixHint", { prefix: prefixName, timeout: prefix.timeoutMs })}
        </text>
      </box>
      {!report.exists ? (
        <box flexDirection="column" gap={0}>
          <text fg={theme.textMuted} wrapMode="word">
            {t("settings.keybindings.createHint")}
          </text>
          <Row
            cursor={props.level === "body" && props.bodyRow === rowIndex(rows, "keys-create")}
            rowRef={props.rowRef(rowIndex(rows, "keys-create"))}
            onMouseUp={select(rowIndex(rows, "keys-create"), props.editor.createFile)}
            fg={theme.text}
            idleBackground={theme.backgroundElement}
          >
            {t("settings.keybindings.createFile")}
          </Row>
        </box>
      ) : null}
      {report.warnings.length > 0 ? (
        <box flexDirection="column" gap={0}>
          <text fg={theme.warning} attributes={TextAttributes.BOLD}>
            {t("settings.keybindings.warnings")}
          </text>
          {report.warnings.map((w) => (
            <text key={w} fg={theme.warning} wrapMode="word">
              {`! ${w}`}
            </text>
          ))}
        </box>
      ) : null}
      {fixedIds.length > 0 ? (
        <text fg={theme.textMuted} wrapMode="word">
          {t("settings.keybindings.fixed", { ids: fixedIds.join(", ") })}
        </text>
      ) : null}
      {groupBindings(editableBindings()).map((group) => (
        <box key={group.category} flexDirection="column" gap={0}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {tKeys("category", group.category)}
          </text>
          {group.rows.map((binding) => {
            const row = rowIndex(rows, keybindingRowId(binding.id))
            const changed = report.applied.some((o) => o.id === binding.id)
            const isRecording = recording?.id === binding.id
            const defaults = [...binding.keys, ...(binding.prefixKeys ?? []).map((stroke) => `${prefixName} ${stroke}`)]
            return (
              <box key={binding.id} flexDirection="column" gap={0}>
                <Row
                  cursor={props.level === "body" && props.bodyRow === row}
                  rowRef={props.rowRef(row)}
                  onMouseUp={select(row, () => props.editor.record(binding.id))}
                  fg={changed ? theme.accent : theme.text}
                  hint={
                    changed && !isRecording
                      ? t("settings.keybindings.defaultKeys", { keys: defaults.join(" / ") })
                      : undefined
                  }
                >
                  {`${clip(tKeys("desc", binding.id)).padEnd(DESCRIPTION_WIDTH)}  ${
                    isRecording ? recordingText(binding.id) : chordsOf(binding.id)
                  }`}
                </Row>
                {notice?.id === binding.id
                  ? notice.lines.map((line) => (
                      <text key={line} fg={theme.warning} wrapMode="word">
                        {`  ! ${line}`}
                      </text>
                    ))
                  : null}
              </box>
            )
          })}
        </box>
      ))}
    </box>
  )
}
