/** @jsxImportSource @opentui/react */
import { type ReactNode, useEffect } from "react"
import { availableEngineIds } from "../../engine/account-detect"
import { bindByIds } from "../../tui/context/keybindings"
import { defaultShell } from "../../tui/panes/terminal/pty-types"
import { openCommandTab } from "../../tui/workspace/terminal-tabs-core"
import { DEFAULT_TASK_VENDOR, type VendorId } from "../../types/task"
import { NewChatDialog } from "../component/new-chat-dialog"
import { useOptionalKV } from "../context/kv"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { useLatest } from "../lib/use-latest"
import { useDialog } from "../ui/dialog"
import {
  knownTabsState,
  reviveEmptiedTabs,
  setTaskTabs,
  tabActivationListeners,
  takeNewTab,
} from "./terminal-tabs-shared"

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

  const startRequestedTab = useLatest((kind: "chat" | "shell") => {
    if (kind === "chat") chooseEngine()
    else {
      const empty = knownTabsState(kv, props.taskId) ?? { tabs: [], activeId: "", nextOrdinal: 1 }
      setTaskTabs(props.taskId, openCommandTab(empty, [defaultShell()], null))
    }
  })

  useEffect(() => {
    const consume = (): void => {
      const kind = takeNewTab(props.taskId)
      if (kind) startRequestedTab.current(kind)
    }
    // Sidebar starts can arrive before activation mounts this pane.
    consume()
    tabActivationListeners.add(consume)
    return () => {
      tabActivationListeners.delete(consume)
    }
  }, [props.taskId])

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
