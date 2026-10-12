/** @jsxImportSource @opentui/react */
import { expect, it } from "bun:test"
import { CommandPalette } from "../../src/tui-react/component/command-palette"
import { DoctorSuggestions } from "../../src/tui-react/component/doctor-suggestions"
import { HelpDialog } from "../../src/tui-react/component/help-dialog"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { bindByIds } from "../../src/tui/context/keybindings"
import { prefixAction } from "../../src/tui/lib/keymap-dispatch"
import { act, renderComponent, settle } from "./harness"

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
