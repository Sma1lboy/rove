/** @jsxImportSource @opentui/react */
/**
 * `dev:mock` — the one general mock scene, no daemon: the real Sidebar on
 * synthetic fixtures next to real TerminalTabs running throwaway shells, on
 * the full provider stack. New surfaces needing a bench go HERE, not in a new
 * dev:mock-* entry; per-pane hosts exist only for bespoke seams.
 *
 * Keys: q / ctrl+c quit · tab cycles pane focus · sidebar j/k/enter live ·
 * terminal tabs ctrl+t/w/]/[ + ctrl+\ / ctrl+= splits live.
 */

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useState } from "react"
import { seedSidebarTasks } from "../../tui/panes/sidebar/mock-fixtures"
import { SIDEBAR_WIDTH } from "../../tui/panes/sidebar/view-core"
import { useFocus } from "../context/focus"
import { useTheme } from "../context/theme"
import { bootPaneHost } from "../lib/host-boot"
import { useBindings } from "../lib/keymap"
import { SidebarTree } from "../panes/sidebar/SidebarTree"
import { TerminalTabs } from "../workspace/TerminalTabs"

const cwd = mkdtempSync(join(tmpdir(), "kobe-mock-react-"))

function MockScene() {
  const { theme, transparentBackground } = useTheme()
  const inactiveBorder = transparentBackground ? theme.border : theme.borderSubtle
  const focus = useFocus()
  const [tasks] = useState(seedSidebarTasks)
  const [selectedId, setSelectedId] = useState<string | null>(tasks.find((t) => t.kind === "task")?.id ?? null)

  useBindings(() => ({
    bindings: [
      { key: "q", cmd: () => process.exit(0) },
      { key: "ctrl+c", cmd: () => process.exit(0) },
      { key: "tab", cmd: () => focus.cycle(1) },
      { key: "shift+tab", cmd: () => focus.cycle(-1) },
    ],
  }))

  return (
    <box flexDirection="row" flexGrow={1} backgroundColor={theme.background}>
      {/* Borderless rail — mirrors workspace/host.tsx (2026-07-27). */}
      <box
        width={SIDEBAR_WIDTH}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
        onMouseUp={() => focus.setFocused("sidebar")}
      >
        <SidebarTree
          width={SIDEBAR_WIDTH}
          tasks={tasks}
          selectedId={selectedId}
          selectedTabId={null}
          onSelect={setSelectedId}
          focused={focus.focused === "sidebar"}
          headerStatus={{ label: "v0.0.0-mock", emphasize: false }}
        />
      </box>
      <box
        flexGrow={1}
        borderColor={focus.focused !== "sidebar" ? theme.focusAccent : inactiveBorder}
        onMouseUp={() => focus.setFocused("workspace")}
      >
        <TerminalTabs
          taskId="mock-workspace-task"
          worktree={cwd}
          command={["sh", "-c", 'echo MOCK-SCENE-OK "(cwd: $PWD)"; exec sh -i']}
          vendor="claude"
          focused={focus.focused !== "sidebar"}
        />
      </box>
    </box>
  )
}

await bootPaneHost({
  logContext: "mock-scene",
  providers: { kv: true, focus: true, notifications: true },
  setup: () => ({ root: () => <MockScene /> }),
})
