/** @jsxImportSource @opentui/react */
import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import * as engines from "../../src/engine/account-detect"
import * as terminalTabs from "../../src/tui-react/workspace/TerminalTabs"
import { ShowWorkspace } from "../../src/tui-react/workspace/show-workspace"
import {
  requestNewTab,
  reviveEmptiedTabs,
  tabsByTask,
  takeNewTab,
} from "../../src/tui-react/workspace/terminal-tabs-shared"
import { defaultShell } from "../../src/tui/panes/terminal/pty-types"
import { type Task, toTaskId } from "../../src/types/task"
import { act, renderComponent, settle, waitForFrameText } from "./harness"

const restore: (() => void)[] = []
afterEach(() => {
  for (const reset of restore.splice(0)) reset()
})

for (const kind of ["main", "dir"] as const) {
  for (const action of ["chat", "shell"] as const) {
    describe(`${kind} sidebar New ${action}`, () => {
      it.each(["before mount", "while mounted"])("consumes an explicit start %s", async (timing) => {
        const id = toTaskId(`sidebar-start-${kind}-${action}-${timing}`)
        const task: Task = {
          id,
          kind,
          title: "Checkout",
          repo: "/tmp/checkout",
          worktreePath: "/tmp/checkout",
          branch: "",
          status: "in_progress",
          vendor: "claude",
          createdAt: "2026-10-20T00:00:00Z",
          updatedAt: "2026-10-20T00:00:00Z",
        }
        const available = spyOn(engines, "availableEngineIds").mockResolvedValue(["claude", "codex"])
        // Replace only PTY hosting; ShowWorkspace and the empty pane stay real.
        const host = spyOn(terminalTabs, "TerminalTabs").mockImplementation(() => <text>Tabs mounted</text>)
        restore.push(
          () => available.mockRestore(),
          () => host.mockRestore(),
        )
        const start = () => {
          reviveEmptiedTabs(null, id, defaultShell())
          requestNewTab(id, action)
        }
        if (timing === "before mount") start()
        const view = await renderComponent(
          <ShowWorkspace
            task={task}
            worktree={task.worktreePath}
            orchestrator={new RemoteOrchestrator(new RoveDaemonClient("/unused-sidebar-start.sock"))}
            focused={true}
            onRequestFocus={() => {}}
            onEditorTabReady={() => {}}
            onEngineSendReady={() => {}}
            onEnginePasteReady={() => {}}
            onDiffTabReady={() => {}}
            onQuickFork={() => {}}
          />,
          { providers: { dialog: true } },
        )
        if (timing === "while mounted") {
          expect(await view.frame()).toContain("No sessions here")
          await act(async () => start())
        }
        if (action === "chat") {
          await waitForFrameText(view.frame, "New conversation", { timeoutMs: 1000 })
          expect(tabsByTask.has(id)).toBe(false)
          await act(async () => {
            view.mockInput.pressArrow("right")
          })
          await settle()
          await act(async () => {
            view.mockInput.pressEnter()
          })
        }
        await waitForFrameText(view.frame, "Tabs mounted", { timeoutMs: 1000 })
        const tabs = tabsByTask.get(id)?.tabs
        expect(tabs).toHaveLength(1)
        expect(tabs?.[0]).toMatchObject(
          action === "chat"
            ? { kind: "engine", vendor: "codex", engineCommand: "codex" }
            : { kind: "command", command: [defaultShell()] },
        )
        expect(takeNewTab(id)).toBeNull()
      })
    })
  }
}
