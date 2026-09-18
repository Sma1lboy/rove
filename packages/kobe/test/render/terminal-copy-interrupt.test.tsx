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
    // With a selection live, ctrl+c COPIES on every platform. Rove draws the
    // selection itself, so no emulator anywhere knows to claim the chord
    // first; gating this on win32 left macOS and Linux interrupting the
    // engine while text sat highlighted.
    expect(copy).toHaveBeenCalledTimes(1)
    expect(copy.mock.calls[0]?.[0]).toContain("COPY_THIS_TEXT")
    expect(fixture.last().writeLog).toEqual([])
    expect(activity).toEqual([])
    // The copy cleared the selection, so the NEXT ctrl+c is an interrupt
    // again — the half of the contract that keeps SIGINT reachable.
    await act(async () => {
      handle.mockInput.pressKey("c", { ctrl: true })
      await settle()
    })
    expect(copy).toHaveBeenCalledTimes(1)
    expect(fixture.last().writeLog).toEqual(["\x03"])
    expect(activity).toEqual(["\x03"])
  } finally {
    Object.defineProperty(process, "platform", platform)
    copy.mockRestore()
    act(() => handle.destroy())
  }
})

/**
 * Kitty CSI-u wire bytes, injected straight into stdin rather than driven
 * through `mockInput.pressKey`. Two reasons: this is byte-for-byte what a
 * kitty-protocol terminal sends, and the harness's modifier plumbing has
 * silently dropped modifiers before — a chord that never arrives renders
 * identically to one that is handled, so a test built on it can pass while
 * the key still misbehaves.
 *
 * Encoding: `ESC [ <codepoint> ; <1 + mask> u`, mask = shift1 alt2 ctrl4
 * super8 meta32. `c` is 99, and macOS Command is `super` — NOT `meta`.
 */
const CMD_C = "\x1b[99;9u"
const CTRL_SHIFT_C = "\x1b[99;6u"
const PLAIN_C = "c"

test.each([
  ["cmd+c (macOS Command)", CMD_C],
  ["ctrl+shift+c", CTRL_SHIFT_C],
])("%s copies the selection and never types a literal", async (_label, wireBytes) => {
  const fixture = createScriptedPtyRegistry()
  const copy = spyOn(clipboard, "copyTextToSystemClipboard").mockResolvedValue(true)
  let mounted: RenderHandle | undefined
  await act(async () => {
    mounted = await renderComponent(
      <box height={12} flexDirection="column">
        <box height={2}>
          <text>spacer</text>
        </box>
        <Terminal cwd="/fixture" taskId="cmdc-test" focused registry={fixture.registry} />
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
    await act(async () => {
      handle.renderer.stdin.emit("data", Buffer.from(wireBytes))
      await settle()
    })
    expect(copy).toHaveBeenCalledTimes(1)
    expect(copy.mock.calls[0]?.[0]).toContain("COPY_THIS_TEXT")
    // The regression: Command arrived as kitty `super`, which `matchKey` did
    // not read, so the chord degraded to the bare letter and the passthrough
    // typed it into the session.
    expect(fixture.last().writeLog).toEqual([])

    // No selection left: the chord must still never type a literal. Cmd+C on
    // an empty selection is a no-op, the way a native terminal treats it.
    await act(async () => {
      handle.renderer.stdin.emit("data", Buffer.from(wireBytes))
      await settle()
    })
    expect(fixture.last().writeLog).toEqual([])

    // Ordinary typing is untouched by the new modifier handling.
    await act(async () => {
      handle.renderer.stdin.emit("data", Buffer.from(PLAIN_C))
      await settle()
    })
    expect(fixture.last().writeLog).toEqual(["c"])
  } finally {
    copy.mockRestore()
    act(() => handle.destroy())
  }
})
