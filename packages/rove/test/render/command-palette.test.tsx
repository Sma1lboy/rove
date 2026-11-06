/** @jsxImportSource @opentui/react */
import { expect, it, mock } from "bun:test"
import { CommandPalette } from "../../src/tui-react/component/command-palette"
import { DoctorSuggestions } from "../../src/tui-react/component/doctor-suggestions"
import { HelpDialog } from "../../src/tui-react/component/help-dialog"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { bindByIds } from "../../src/tui/context/keybindings"
import { prefixAction } from "../../src/tui/lib/keymap-dispatch"
import { act, renderComponent, settle } from "./harness"

const searched: string[] = []
mock.module("../../src/engine/session-search", () => ({
  searchTasks: async (_tasks: unknown, query: string) => {
    searched.push(query)
    return {
      query,
      matches: [
        {
          taskId: "T1",
          title: "Audit the daemon",
          tabId: "tab-2",
          role: "user",
          at: new Date().toISOString(),
          snippet: "Create NOTES.md with one line 'restart path audit'",
        },
      ],
      skipped: [],
      truncated: false,
    }
  },
}))

it("filters real help rows by action name and shows an empty result", async () => {
  const r = await renderComponent(<HelpDialog currentScope="sidebar" />, { providers: { dialog: true } })
  await act(async () => {
    r.mockInput.pressKey("/")
    await settle()
  })
  await act(async () => {
    r.mockInput.typeText("worktree")
    await settle()
  })
  expect(await r.frame()).toContain("Open worktrees")
  expect(await r.frame()).not.toContain("Open settings")
  await act(async () => {
    r.mockInput.typeText("zzzz")
    await settle()
  })
  expect(await r.frame()).toContain("No matching actions")
  r.destroy()
})

it("opens via prefix, learns the chord and executes after the modal closes", async () => {
  let calls = 0
  function Driver() {
    const dialog = useDialog()
    useBindings(() => ({
      enabled: dialog.stack.length === 0,
      bindings: bindByIds({
        "palette.open": prefixAction(() => CommandPalette.show(dialog)),
        "settings.open": prefixAction(() => calls++),
      }),
    }))
    return <text>Workspace</text>
  }
  const r = await renderComponent(<Driver />, { providers: { dialog: true } })
  await act(async () => {
    r.mockInput.pressKey("a", { ctrl: true })
    r.mockInput.pressKey("/")
    await settle()
  })
  expect(await r.frame()).toContain("Search commands")
  await act(async () => {
    r.mockInput.typeText("sttng")
    await settle()
  })
  const frame = await r.frame()
  expect(frame).toContain("Open settings")
  expect(frame).toContain(",")
  await act(async () => {
    r.mockInput.pressEnter()
    await settle()
  })
  expect(calls).toBe(1)
  expect(await r.frame()).not.toContain("Search commands")
  r.destroy()
})

it("prints both doctor fix kinds without offering an execution control", async () => {
  const r = await renderComponent(
    <DoctorSuggestions
      fixes={[
        {
          kind: "run",
          id: "restart",
          label: "Daemon unavailable",
          command: ["rove", "daemon", "restart"],
          why: "Keeps sessions",
        },
        {
          kind: "manual",
          id: "login",
          label: "Login required",
          action: "Sign in from your engine CLI",
          why: "Only you can authorize",
        },
      ]}
    />,
  )
  const frame = await r.frame()
  expect(frame).toContain("rove daemon restart")
  expect(frame).toContain("Sign in from your engine CLI")
  expect(frame).toContain("Only you can authorize")
  await act(async () => {
    r.mockInput.pressEnter()
    await settle()
  })
  expect(await r.frame()).toBe(frame)
  r.destroy()
})

it("lists tasks by title and conversation hits, and Enter on a hit opens its task on that tab", async () => {
  const opened: Array<[string, string | undefined]> = []
  const search = {
    orchestrator: { listTasks: () => [] } as never,
    tasks: [{ id: "T2", title: "Restart the bridge", kind: "task" }] as never,
    openTask: (taskId: string, tabId?: string) => opened.push([taskId, tabId]),
    debounceMs: 0,
  }
  function Driver() {
    const dialog = useDialog()
    useBindings(() => ({
      enabled: dialog.stack.length === 0,
      bindings: bindByIds({ "palette.open": prefixAction(() => CommandPalette.show(dialog, search)) }),
    }))
    return <text>Workspace</text>
  }
  const r = await renderComponent(<Driver />, { providers: { dialog: true } })
  await act(async () => {
    r.mockInput.pressKey("a", { ctrl: true })
    r.mockInput.pressKey("/")
    await settle()
  })
  await act(async () => {
    r.mockInput.typeText("restart")
    await settle()
  })
  await act(async () => settle())
  expect(searched.at(-1)).toBe("restart")
  const frame = await r.frame()
  expect(frame).toContain("Tasks")
  expect(frame).toContain("Restart the bridge")
  expect(frame).toContain("In conversations")
  expect(frame).toContain("Audit the daemon")
  expect(frame).toContain("restart path audit")
  // Down past the task row onto the conversation hit.
  await act(async () => {
    r.mockInput.pressArrow("down")
    r.mockInput.pressArrow("down")
    await settle()
  })
  await act(async () => {
    r.mockInput.pressEnter()
    await settle()
  })
  expect(opened).toEqual([["T1", "tab-2"]])
  expect(await r.frame()).not.toContain("Search commands")
  r.destroy()
})
