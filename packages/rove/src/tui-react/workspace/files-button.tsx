/** @jsxImportSource @opentui/react */
/** The window's top row: the Files button at its right end, as the web's panel launcher. */

import { TextAttributes } from "@opentui/core"
import { ShortcutRevealBadge } from "../component/shortcut-reveal"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useHoverFill } from "../ui/use-hover-fill"

export type FilesToggle = { readonly open: boolean; readonly toggle: () => void }

/** `files` is null where there is no Files pane to show (a rail page); the row stays, so the panes do not jump. */
export function TopBar(props: { readonly files: FilesToggle | null }) {
  return (
    <box flexDirection="row" flexShrink={0} height={1} paddingRight={1} justifyContent="flex-end">
      {props.files ? <FilesButton files={props.files} /> : null}
    </box>
  )
}

function FilesButton(props: { readonly files: FilesToggle }) {
  const { theme } = useTheme()
  const t = useT()
  const hover = useHoverFill()
  return (
    <box
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      // On is the stronger fill; a hover only washes a button that is off.
      backgroundColor={props.files.open ? theme.backgroundElement : hover.fill}
      {...hover.handlers}
      onMouseUp={(evt: { stopPropagation(): void }) => {
        evt.stopPropagation()
        props.files.toggle()
      }}
    >
      <text
        fg={props.files.open || hover.hovered ? theme.text : theme.textMuted}
        attributes={props.files.open ? TextAttributes.BOLD : undefined}
        wrapMode="none"
      >
        {t("keys.category.Files")}
      </text>
      <ShortcutRevealBadge bindingId="workspace.filesToggle" />
    </box>
  )
}
