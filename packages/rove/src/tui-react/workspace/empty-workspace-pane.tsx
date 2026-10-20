/** @jsxImportSource @opentui/react */
import type { ReactNode } from "react"
import { availableEngineIds } from "../../engine/account-detect"
import { bindByIds } from "../../tui/context/keybindings"
import { defaultShell } from "../../tui/panes/terminal/pty-types"
import { DEFAULT_TASK_VENDOR, type VendorId } from "../../types/task"
import { NewChatDialog } from "../component/new-chat-dialog"
import { useOptionalKV } from "../context/kv"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { useDialog } from "../ui/dialog"
import { knownTabsState, reviveEmptiedTabs } from "./terminal-tabs-shared"

export function EmptyWorkspacePane(props: {
  taskId: string
  focused: boolean
  vendor?: VendorId
  command?: string
}): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const kv = useOptionalKV()
  const dialog = useDialog()
  const vendor = props.vendor ?? DEFAULT_TASK_VENDOR

  // `reviveEmptiedTabs` bumps the revision `show-workspace` watches, which
  // swaps in TerminalTabs next render; no host callback needed.
  const reopen = (): void => {
    reviveEmptiedTabs(
      kv,
      props.taskId,
      defaultShell(),
      knownTabsState(kv, props.taskId) ? undefined : { vendor, engineCommand: props.command ?? vendor },
    )
  }

  const chooseEngine = (): void => {
    void (async () => {
      const choice = await NewChatDialog.show(dialog, await availableEngineIds(), vendor, { freshTabOnly: true })
      if (!choice) return
      reviveEmptiedTabs(kv, props.taskId, defaultShell(), { vendor: choice.pick, engineCommand: choice.pick })
    })()
  }

  useBindings(() => ({
    enabled: props.focused,
    bindings: bindByIds({
      "workspace.reopenSession": reopen,
      "chat.tab.chooseEngine": chooseEngine,
    }),
  }))

  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <text fg={theme.textMuted}>{t("workspace.empty.noSessions")}</text>
    </box>
  )
}
