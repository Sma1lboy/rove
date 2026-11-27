/** @jsxImportSource @opentui/react */
/** The Files button, set into the right end of the panes' top border (`──── Files ─┐`), as the web's panel launcher. */

import { TextAttributes } from "@opentui/core"
import { ShortcutRevealBadge } from "../component/shortcut-reveal"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useHoverFill } from "../ui/use-hover-fill"

export type FilesToggle = { readonly open: boolean; readonly toggle: () => void }

/** `files` is null where there is no Files pane to show (a rail page). Over the border, not a row of its own: a row held only this button. */
export function TopBar(props: { readonly files: FilesToggle | null }) {
  if (!props.files) return null
  return (
    <box position="absolute" top={0} right={2} zIndex={1} height={1} flexDirection="row">
      <FilesButton files={props.files} />
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
      flexDirection="row"
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
        {/* No-break spaces, not padding or " ": over a transparent background a blank cell keeps the border's dash under it. */}
        {`\u00a0${t("keys.category.Files")}\u00a0`}
      </text>
      <ShortcutRevealBadge bindingId="workspace.filesToggle" />
    </box>
  )
}
