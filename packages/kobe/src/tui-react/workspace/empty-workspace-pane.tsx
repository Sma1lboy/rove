/** @jsxImportSource @opentui/react */
/**
 * Placeholder for a task whose last tab closed, and the keys out of it.
 * `TerminalTabs` (which registers the open-session chords) is NOT mounted
 * over an empty tab list, and this pane is reachable without an activation
 * (restart restore), so it binds the chords itself; both revive the session:
 *   - `workspace.reopenSession` (⏎).
 *   - `chat.tab.chooseEngine` (ctrl+e), the SAME id `TerminalTabs` binds.
 */

import type { ReactNode } from "react"
import { bindByIds } from "../../tui/context/keybindings"
import { defaultShell } from "../../tui/panes/terminal/pty-types"
import { useOptionalKV } from "../context/kv"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { reviveEmptiedTabs } from "./terminal-tabs-shared"

export function EmptyWorkspacePane(props: { taskId: string; focused: boolean }): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const kv = useOptionalKV()

  // `reviveEmptiedTabs` bumps the revision `show-workspace` watches, which
  // swaps in TerminalTabs next render; no host callback needed.
  const reopen = (): void => {
    reviveEmptiedTabs(kv, props.taskId, defaultShell())
  }

  useBindings(() => ({
    enabled: props.focused,
    bindings: bindByIds({
      "workspace.reopenSession": reopen,
      "chat.tab.chooseEngine": reopen,
    }),
  }))

  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <text fg={theme.textMuted}>{t("workspace.empty.noSessions")}</text>
    </box>
  )
}
