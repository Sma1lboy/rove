/** @jsxImportSource @opentui/react */
/** The Files button at the end of the workspace's top row, as the web's panel launcher. */

import { TextAttributes } from "@opentui/core"
import { createContext, useContext } from "react"
import { ShortcutRevealBadge } from "../component/shortcut-reveal"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"

export type FilesToggle = { readonly open: boolean; readonly toggle: () => void }

/** Null where there is no Files pane to show (a rail page, narrow mode). */
export const FilesToggleContext = createContext<FilesToggle | null>(null)
export const useFilesToggle = () => useContext(FilesToggleContext)

export function FilesButton(props: { readonly files: FilesToggle }) {
  const { theme } = useTheme()
  const t = useT()
  return (
    <box
      flexShrink={0}
      alignSelf="center"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.files.open ? theme.backgroundElement : undefined}
      onMouseUp={(evt: { stopPropagation(): void }) => {
        evt.stopPropagation()
        props.files.toggle()
      }}
    >
      <text
        fg={props.files.open ? theme.text : theme.textMuted}
        attributes={props.files.open ? TextAttributes.BOLD : undefined}
        wrapMode="none"
      >
        {t("keys.category.Files")}
      </text>
      <ShortcutRevealBadge bindingId="workspace.filesToggle" />
    </box>
  )
}
