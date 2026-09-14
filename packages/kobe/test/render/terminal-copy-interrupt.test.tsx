/** @jsxImportSource @opentui/react */
import { expect, spyOn, test } from "bun:test"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import * as clipboard from "../../src/tui/lib/clipboard-copy"
import { createScriptedPtyRegistry } from "../../src/tui/panes/terminal/pty-scripted"
import { type RenderHandle, act, renderComponent, settle } from "./harness"

test.each(["win32", "darwin", "linux"] as const)("%s routes selected and unselected Ctrl+C", async (targetPlatform) => {
  const fixture = createScriptedPtyRegistry()
  const activity: string[] = []
  const copy = spyOn(clipboard, "copyTextToSystemClipboard").mockResolvedValue(true)
  const platform = Object.getOwnPropertyDescriptor(process, "platform")
  if (!platform) throw new Error("process.platform descriptor missing")
  let mounted: RenderHandle | undefined
  await act(async () => {
    mounted = await renderComponent(
      <box height={12} flexDirection="column">
        <box height={2}>
          <text>spacer</text>
        </box>
        <Terminal
          cwd="/fixture"
          taskId="copy-test"
          focused
          registry={fixture.registry}
          onUserInput={(data) => activity.push(data)}
        />
      </box>,
      { width: 60, height: 12, exitOnCtrlC: false, providers: { dialog: true } },
    )
  })
  if (!mounted) throw new Error("terminal did not mount")
  const handle = mounted
  try {
    await act(async () => {
      fixture.last().feed("  COPY_THIS_TEXT\r\nsecond line\r\nthird line")
      await handle.frame()
    })
    await act(async () => {
      await handle.frame()
    })
    await act(async () => {
      await handle.mockMouse.pressDown(2, 2)
      await handle.mockMouse.emitMouseEvent("drag", 20, 3)
    })
    await act(async () => {
      await handle.frame()
    })
    Object.defineProperty(process, "platform", { ...platform, value: targetPlatform })
    await act(async () => {
      handle.mockInput.pressKey("c", { ctrl: true })
      await settle()
    })
    if (targetPlatform === "win32") {
      expect(copy).toHaveBeenCalledTimes(1)
      expect(copy.mock.calls[0]?.[0]).toContain("COPY_THIS_TEXT")
      expect(fixture.last().writeLog).toEqual([])
      expect(activity).toEqual([])
    } else {
      expect(copy).not.toHaveBeenCalled()
      expect(fixture.last().writeLog).toEqual(["\x03"])
    }
    await act(async () => {
      handle.mockInput.pressKey("c", { ctrl: true })
      await settle()
    })
    expect(copy).toHaveBeenCalledTimes(targetPlatform === "win32" ? 1 : 0)
    const interrupts = targetPlatform === "win32" ? ["\x03"] : ["\x03", "\x03"]
    expect(fixture.last().writeLog).toEqual(interrupts)
    expect(activity).toEqual(interrupts)
  } finally {
    Object.defineProperty(process, "platform", platform)
    copy.mockRestore()
    act(() => handle.destroy())
  }
})
