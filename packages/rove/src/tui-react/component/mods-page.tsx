/** @jsxImportSource @opentui/react */
/**
 * ModsPage — every open mod pane, drawn natively from the element tree the
 * daemon validated (`plugins/mod-host.ts`). The web draws the same trees with
 * DOM elements; this file is the OpenTUI half of that one vocabulary. A press
 * goes back to the mod, which redraws; nothing here holds mod state.
 */

import { TextAttributes } from "@opentui/core"
import type { ModNode, ModPaneView, ModTone } from "@sma1lboy/rove-daemon/plugins/mod-tree"
import { type ReactNode, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import {
  type ModButtonRef,
  modButtons,
  moveModCursor,
  resolveModCursor,
  sameModButton,
} from "../../tui/panes/mods/mods-core"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import { dividerRule } from "../lib/rule-divider"
import { useAccessor } from "../lib/use-accessor"
import { useTerminalSize } from "../lib/use-terminal-size"
import { FRAME } from "../ui/frame"

type Theme = ReturnType<typeof useTheme>["theme"]

function toneColor(tone: ModTone | undefined, theme: Theme): Theme["text"] {
  switch (tone) {
    case "info":
      return theme.info
    case "success":
      return theme.success
    case "warning":
      return theme.warning
    case "error":
      return theme.error
    case "muted":
      return theme.textMuted
    default:
      return theme.text
  }
}

interface TreeProps {
  readonly node: ModNode
  readonly pane: ModPaneView
  readonly cursor: ModButtonRef | null
  readonly theme: Theme
  readonly onPress: (ref: ModButtonRef) => void
}

/** One element → OpenTUI. Spacing steps are cells; a box's flex is Yoga's. */
function ModTree(props: TreeProps): ReactNode {
  const { node, theme } = props
  if (node.type === "text") {
    return (
      <text fg={toneColor(node.tone, theme)} attributes={node.bold ? TextAttributes.BOLD : undefined}>
        {node.text}
      </text>
    )
  }
  if (node.type === "button") {
    const ref = { plugin: props.pane.plugin, pane: props.pane.id, key: node.key }
    const focused = sameModButton(ref, props.cursor)
    return (
      <text
        flexShrink={0}
        wrapMode="none"
        fg={toneColor(node.tone ?? "info", theme)}
        // The house focus mark (see the dialogs' selector fields).
        attributes={focused ? TextAttributes.BOLD | TextAttributes.UNDERLINE : TextAttributes.BOLD}
        onMouseUp={(e: { stopPropagation(): void }) => {
          e.stopPropagation()
          props.onPress(ref)
        }}
      >
        {`[ ${node.label} ]`}
      </text>
    )
  }
  return (
    <box
      flexDirection={node.direction ?? "column"}
      gap={node.gap ?? 0}
      padding={node.padding ?? 0}
      flexShrink={0}
      {...(node.border ? { ...FRAME, borderColor: theme.border } : {})}
    >
      {node.children.map((child, i) => (
        // Children carry no stable id; position is the identity a redraw keeps.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <ModTree key={i} {...props} node={child} />
      ))}
    </box>
  )
}

export function ModsPage(props: { orchestrator: RemoteOrchestrator; focused: boolean; onClose: () => void }) {
  const { theme } = useTheme()
  const t = useT()
  const dims = useTerminalSize()
  const notif = useNotifications()
  const panes = useAccessor(props.orchestrator.modPanesSignal())
  const buttons = modButtons(panes)
  const [rawCursor, setCursor] = useState<ModButtonRef | null>(null)
  const cursor = resolveModCursor(buttons, rawCursor)

  const press = (ref: ModButtonRef): void => {
    setCursor(ref)
    props.orchestrator
      .pressMod(ref.plugin, ref.pane, ref.key)
      .then((res) => {
        const reason =
          (res as { ok?: boolean; reason?: string } | undefined)?.ok === false
            ? (res as { reason?: string }).reason
            : null
        if (reason)
          notif.notify({
            kind: "error",
            taskId: "",
            tabId: "",
            title: t("mods.pressFailed", { plugin: ref.plugin, reason }),
          })
      })
      .catch((err: unknown) =>
        notif.notify({
          kind: "error",
          taskId: "",
          tabId: "",
          title: t("mods.pressFailed", { plugin: ref.plugin, reason: String(err) }),
        }),
      )
  }

  useBindings(() => ({
    enabled: props.focused,
    bindings: [
      ...pageCloseBindings(props.onClose),
      { key: "down", cmd: () => setCursor(moveModCursor(buttons, cursor, 1)) },
      { key: "tab", cmd: () => setCursor(moveModCursor(buttons, cursor, 1)) },
      { key: "up", cmd: () => setCursor(moveModCursor(buttons, cursor, -1)) },
      { key: "shift+tab", cmd: () => setCursor(moveModCursor(buttons, cursor, -1)) },
      { key: "return", cmd: () => cursor && press(cursor) },
    ],
  }))

  return (
    <box flexDirection="column" flexGrow={1} paddingTop={1} paddingLeft={2} paddingRight={2}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text attributes={TextAttributes.BOLD} fg={theme.text} wrapMode="none" flexShrink={0}>
          {t("mods.title")}
        </text>
        <text fg={theme.borderSubtle} wrapMode="none" flexBasis={0} flexGrow={1} flexShrink={1}>
          {dividerRule(dims.width)}
        </text>
        <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
          {t("mods.keys")}
        </text>
      </box>
      {panes.length === 0 ? (
        <box flexDirection="column" paddingTop={1}>
          <text fg={theme.text}>{t("mods.empty")}</text>
          <text fg={theme.textMuted}>{t("mods.emptyHint")}</text>
        </box>
      ) : (
        <scrollbox flexGrow={1} paddingTop={1}>
          {panes.map((pane) => (
            <box
              key={`${pane.plugin}/${pane.id}`}
              flexDirection="column"
              flexShrink={0}
              marginBottom={1}
              paddingLeft={1}
              paddingRight={1}
              {...FRAME}
              borderColor={theme.border}
            >
              <box flexDirection="row" gap={1} flexShrink={0}>
                <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
                  {pane.title}
                </text>
                <text fg={theme.textMuted} wrapMode="none">{`· ${pane.plugin}`}</text>
              </box>
              <ModTree node={pane.tree} pane={pane} cursor={cursor} theme={theme} onPress={press} />
            </box>
          ))}
        </scrollbox>
      )}
    </box>
  )
}
