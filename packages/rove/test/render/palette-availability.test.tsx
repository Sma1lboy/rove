/** @jsxImportSource @opentui/react */
import { expect, it } from "bun:test"
import { CommandPalette } from "../../src/tui-react/component/command-palette"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { bindByIds } from "../../src/tui/context/keybindings"
import { prefixAction } from "../../src/tui/lib/keymap-dispatch"
import { act, renderComponent, settle } from "./harness"

it("keeps terminal passthrough silent while the palette is open and cancels without running", async () => {
  let terminalInput = ""
  let calls = 0
  function Driver() {
    const dialog = useDialog()
    useBindings(() => ({
      bindings: [
        ...bindByIds({
          "palette.open": prefixAction(() => CommandPalette.show(dialog)),
          "settings.open": prefixAction(() => calls++),
        }),
        {
          key: "s",
          passthrough: true,
          cmd: () => {
            terminalInput += "s"
          },
        },
      ],
    }))
    return <text>Terminal</text>
  }
  const r = await renderComponent(<Driver />, { providers: { dialog: true } })
  await act(async () => {
    r.mockInput.pressKey("a", { ctrl: true })
    r.mockInput.pressKey("/")
    await settle()
  })
  await act(async () => {
    r.mockInput.typeText("settings")
    await settle()
  })
  expect(await r.frame()).toContain("Open settings")
  expect(terminalInput).toBe("")
  await act(async () => {
    r.mockInput.pressEscape()
    await settle()
  })
  expect(calls).toBe(0)
  expect(await r.frame()).not.toContain("Search commands")
})
