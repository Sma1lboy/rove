/** @jsxImportSource @opentui/react */
/**
 * "Engine exited" strip over the terminal: the engine is gone and only its
 * keepAlive shell is left, so the pane names the three ways out. Each action
 * is a click target, and advertises the chord the keymap currently binds to it.
 */

import { currentPrefixConfiguration } from "../../../tui/lib/keymap-dispatch"
import { shortcutCaption } from "../../../tui/lib/shortcut-reveal"
import { useKeymapVersion } from "../../context/keybindings"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { currentBindingReachability, useBindingStackVersion } from "../../lib/keymap"

export interface EngineExit {
  /** The engine's exit code, when the daemon recorded one. */
  readonly code: number | null
  /** Relaunch the engine in this tab (resuming its conversation where the engine can). */
  readonly onRetry: () => void
  /** Absent = the host cannot open Settings from here; the action is not offered. */
  readonly onSettings?: () => void
  readonly onAnotherEngine: () => void
}

function Action(props: { label: string; bindingId: string; onPress: () => void; onRequestFocus?: () => void }) {
  const { theme } = useTheme()
  // Reachability changes with focus and rebinds, not with props.
  useKeymapVersion()
  useBindingStackVersion()
  const caption = shortcutCaption({
    bindingId: props.bindingId,
    reachability: currentBindingReachability(),
    prefixKey: currentPrefixConfiguration().key,
  })
  return (
    <box flexDirection="row" flexShrink={0} columnGap={1}>
      <text
        fg={theme.info}
        wrapMode="none"
        onMouseUp={(event) => {
          event.stopPropagation()
          if (event.button !== 0) return
          props.onPress()
          props.onRequestFocus?.()
        }}
      >
        {`[${props.label}]`}
      </text>
      {caption ? (
        <text fg={theme.textMuted} wrapMode="none">
          {caption}
        </text>
      ) : null}
    </box>
  )
}

export function EngineExitBanner(props: EngineExit & { onRequestFocus?: () => void }) {
  const { theme } = useTheme()
  const t = useT()
  return (
    <box
      flexDirection="row"
      flexWrap="wrap"
      flexShrink={0}
      columnGap={2}
      paddingLeft={1}
      paddingRight={1}
      // The pane's selection handlers must not start a drag under a click on the strip.
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
    >
      <text fg={theme.error} wrapMode="none">
        {props.code === null
          ? t("terminal.engineExit.title")
          : t("terminal.engineExit.titleCode", { code: props.code })}
      </text>
      <Action
        label={t("terminal.engineExit.retry")}
        bindingId="terminal.reset"
        onPress={props.onRetry}
        onRequestFocus={props.onRequestFocus}
      />
      {props.onSettings ? (
        <Action label={t("terminal.engineExit.settings")} bindingId="settings.open" onPress={props.onSettings} />
      ) : null}
      <Action
        label={t("terminal.engineExit.another")}
        bindingId="chat.tab.chooseEngine"
        onPress={props.onAnotherEngine}
      />
    </box>
  )
}
