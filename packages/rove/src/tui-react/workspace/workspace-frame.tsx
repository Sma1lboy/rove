/** @jsxImportSource @opentui/react */
/**
 * The workspace pane's frame: border, running-flow overlay and title. It owns
 * the spinner subscription on purpose — `flow` breathes at 12.5 Hz, and that
 * must re-render this box alone, not the whole workspace host.
 */

import { type RGBA, TextAttributes } from "@opentui/core"
import type { ReactNode } from "react"
import { TASK_PARTNER_HUE_DEG } from "../../tui/lib/border-flow"
import { ShortcutRevealBadge } from "../component/shortcut-reveal"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useSpinnerFrame } from "../panes/sidebar/row-cards"
import { runningPaneFlow } from "./running-pane-chrome"

export function WorkspacePaneFrame(props: {
  /** The selected task's engine is running and the working border is `flow`. */
  readonly workingFlow: boolean
  /** The selected task's own hue, if any. */
  readonly taskInk: RGBA | undefined
  readonly focused: boolean
  readonly inactiveBorder: RGBA
  /** The task title + "running" hint, or undefined when not running. */
  readonly title: string | undefined
  readonly onActivate: () => void
  /** The Files button on the top edge; absent where there is no Files pane to show. */
  readonly files?: { readonly open: boolean; readonly onToggle: () => void }
  readonly children?: ReactNode
}) {
  const { theme } = useTheme()
  const t = useT()
  const breath = useSpinnerFrame(props.workingFlow)
  return (
    <box
      flexGrow={1}
      flexShrink={1}
      borderStyle="rounded"
      borderColor={props.focused ? theme.focusAccent : props.inactiveBorder}
      renderAfter={
        props.workingFlow
          ? runningPaneFlow(
              props.taskInk ?? theme.focusAccent,
              props.inactiveBorder,
              props.focused,
              breath,
              props.taskInk ? TASK_PARTNER_HUE_DEG : undefined,
            )
          : undefined
      }
      title={props.workingFlow ? props.title : undefined}
      onMouseUp={props.onActivate}
    >
      {props.children}
      {props.files ? (
        // On the frame's top edge, so it spends no row of the pane.
        <box
          position="absolute"
          top={-1}
          right={1}
          zIndex={10}
          onMouseUp={(evt: { stopPropagation(): void }) => {
            evt.stopPropagation()
            props.files?.onToggle()
          }}
        >
          <text
            fg={props.files.open ? theme.text : theme.textMuted}
            attributes={props.files.open ? TextAttributes.BOLD : undefined}
            wrapMode="none"
          >
            {` ${t("keys.category.Files")} `}
          </text>
          <ShortcutRevealBadge bindingId="workspace.filesToggle" />
        </box>
      ) : null}
    </box>
  )
}
