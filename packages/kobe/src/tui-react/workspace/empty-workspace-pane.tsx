/** @jsxImportSource @opentui/react */
/**
 * The placeholder for a task whose last tab was closed — and the keys that
 * get out of it.
 *
 * `show-workspace` deliberately does NOT mount `TerminalTabs` over an empty
 * tab list, which means every "open a session here" chord is unreachable in
 * this state: they are all registered inside that component. Entering the
 * task from the sidebar revives it (`reviveEmptiedTabs`), but this pane is
 * also reached WITHOUT an activation — restart restore, or a task emptied
 * while already on screen — and there the placeholder used to name two keys
 * that had no handler at all.
 *
 * So the placeholder owns them itself. Both chords do the same thing (revive
 * this task's session), because from here there is only one thing to do:
 *   - `workspace.reopenSession` (⏎) — owner sign-off 2026-08-31.
 *   - `chat.tab.chooseEngine` (ctrl+e) — the SAME id `TerminalTabs` binds.
 *     Registering it here is not a second chord, it is the one chord staying
 *     answerable in the state where its usual owner is unmounted.
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

  // `reviveEmptiedTabs` writes through `setTaskTabs`, so the revision counter
  // `show-workspace` subscribes to bumps and this pane is replaced by the
  // mounted TerminalTabs on the next render — no callback up to the host.
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
