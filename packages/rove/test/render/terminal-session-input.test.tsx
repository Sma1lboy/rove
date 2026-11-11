/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { useState } from "react"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { DialogConfirm } from "../../src/tui-react/ui/dialog-confirm"
import { resetPrefixState } from "../../src/tui/lib/keymap-dispatch"
import { createScriptedPtyRegistry } from "../../src/tui/panes/terminal/pty-scripted"
import { type RenderHandle, act, renderComponent, settle } from "./harness"

async function mount(ui: Parameters<typeof renderComponent>[0]): Promise<RenderHandle> {
  let handle: RenderHandle | undefined
  await act(async () => {
    handle = await renderComponent(ui, { width: 70, height: 16, providers: { dialog: true } })
  })
  // A pane learns its size on the frame after it mounts, and acquires its PTY then.
  await act(async () => {
    await handle?.frame()
  })
  if (!handle) throw new Error("terminal did not mount")
  return handle
}

async function frame(handle: RenderHandle): Promise<string> {
  let text = ""
  await act(async () => {
    text = await handle.frame()
  })
  return text
}

test("switching sessions releases the old listeners while retaining registry PTYs", async () => {
  const fixture = createScriptedPtyRegistry()
  const exits: string[] = []
  let select: ((id: string) => void) | undefined
  function Switchable() {
    const [id, setId] = useState("alpha::tab-1")
    select = setId
    return <Terminal cwd="/fixture" taskId={id} focused registry={fixture.registry} onExit={() => exits.push(id)} />
  }
  const handle = await mount(<Switchable />)
  try {
    const alpha = fixture.last()
    await act(async () => {
      alpha.feed(Array.from({ length: 80 }, (_, i) => `ALPHA history ${i}`).join("\r\n"))
      await handle.frame()
    })
    await act(async () => {
      handle.resize(80, 20)
      await handle.frame()
    })
    expect(fixture.ptys).toHaveLength(1)
    await act(async () => {
      select?.("bravo::tab-1")
      await settle()
    })
    // The new session's pane sizes itself, and acquires its PTY, on the next frame.
    await frame(handle)
    const bravo = fixture.last()
    expect(bravo).not.toBe(alpha)
    await act(async () => {
      bravo.feed("BRAVO current session")
      await handle.mockInput.typeText("bravo-only")
      await settle()
    })
    expect(bravo.writeLog.join("")).toBe("bravo-only")
    expect(alpha.writeLog).toEqual([])
    expect(alpha.killed).toBe(false)

    await act(async () => {
      alpha.feed("\r\nALPHA while hidden")
      select?.("alpha::tab-1")
      await settle()
    })
    expect(fixture.ptys).toHaveLength(2)
    await frame(handle)
    expect(await frame(handle)).toContain("ALPHA while hidden")
    await act(async () => {
      bravo.kill()
      await handle.mockInput.typeText("alpha-only")
      await settle()
    })
    expect(exits).toEqual([])
    expect(alpha.writeLog.join("")).toBe("alpha-only")
    expect(bravo.writeLog.join("")).toBe("bravo-only")
    act(() => handle.destroy())
    expect(alpha.killed).toBe(false)
    alpha.kill()
    expect(exits).toEqual([])
  } finally {
    act(() => handle.destroy())
    fixture.registry.releaseAll()
    resetPrefixState()
  }
})

test("split focus and modal ownership gate terminal paste", async () => {
  const fixture = createScriptedPtyRegistry()
  let focus: ((id: string) => void) | undefined
  let confirm: (() => void) | undefined
  function Splits() {
    const [id, setId] = useState("alpha")
    const dialog = useDialog()
    focus = setId
    confirm = () => void DialogConfirm.show(dialog, "Modal owner", "Keep terminal input paused")
    return (
      <box flexDirection="row" flexGrow={1}>
        {["alpha", "bravo"].map((key) => (
          <box key={key} flexGrow={1} flexBasis={0}>
            <Terminal
              cwd="/fixture"
              taskId={key}
              focused={key === id}
              imeAnchorActive={key === id}
              registry={fixture.registry}
            />
          </box>
        ))}
      </box>
    )
  }
  const handle = await mount(<Splits />)
  const paste = async (text: string): Promise<void> => {
    await act(async () => {
      handle.mockInput.pressKey(`\x1b[200~${text}\x1b[201~`)
      await settle()
    })
  }
  try {
    const [alpha, bravo] = fixture.ptys
    expect(fixture.ptys).toHaveLength(2)
    await act(async () => {
      focus?.("bravo")
      await settle()
    })
    await paste("bravo paste")
    expect(bravo.pastes).toEqual(["bravo paste"])
    expect(alpha.pastes).toEqual([])
    await act(async () => {
      focus?.("alpha")
      await settle()
    })
    await paste(" text")
    expect(alpha.pastes).toEqual([" text"])
    await act(async () => {
      confirm?.()
      await settle()
    })
    expect(await frame(handle)).toContain("Modal owner")
    await paste("blocked")
    await act(async () => {
      handle.mockInput.pressEscape()
      await settle()
    })
    expect(await frame(handle)).not.toContain("blocked")
    expect(alpha.pastes).toEqual([" text"])
    expect(bravo.pastes).toEqual(["bravo paste"])
    await act(async () => {
      handle.mockInput.pressEscape()
      await settle()
    })
    await paste("alpha paste")
    expect(alpha.pastes).toEqual([" text", "alpha paste"])
    expect(bravo.pastes).toEqual(["bravo paste"])
  } finally {
    act(() => handle.destroy())
    fixture.registry.releaseAll()
    resetPrefixState()
  }
})
