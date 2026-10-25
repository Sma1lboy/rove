/** @jsxImportSource @opentui/react */
/**
 * A dead engine leaves a live keepAlive shell, so the pane cannot tell on its
 * own. The strip appears only when the host passes positive evidence
 * (`engineExit`), and every way out it names must be reachable by a click.
 */
import { expect, test } from "bun:test"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import type { EngineExit } from "../../src/tui-react/panes/terminal/engine-exit-banner"
import { MockTaskPty } from "../../src/tui/panes/terminal/pty-mock"
import { PtyRegistry } from "../../src/tui/panes/terminal/registry"
import { act, renderComponent, settle } from "./harness"

function mount(engineExit?: EngineExit) {
  const registry = new PtyRegistry((opts) => new MockTaskPty(opts))
  return renderComponent(
    <Terminal cwd="/fixture" taskId="engine-exit" focused registry={registry} engineExit={engineExit} />,
    { width: 110, height: 16, providers: { dialog: true, kv: true, notifications: true } },
  )
}

const calls: string[] = []
const exitProps = (code: number | null): EngineExit => ({
  code,
  onRetry: () => calls.push("retry"),
  onSettings: () => calls.push("settings"),
  onAnotherEngine: () => calls.push("another"),
})

test("a healthy engine draws no exit strip", async () => {
  const { frame } = await mount()
  await settle(200)
  const output = await frame()
  expect(output).not.toContain("Engine exited")
  expect(output).not.toContain("[Retry]")
})

test("the exit strip names the code and each action fires on click", async () => {
  calls.length = 0
  const { frame, mockMouse } = await mount(exitProps(127))
  await settle(200)
  expect(await frame()).toContain("Engine exited (code 127)")

  for (const [label, expected] of [
    ["[Retry]", "retry"],
    ["[Settings → Engines]", "settings"],
    ["[Another engine]", "another"],
  ] as const) {
    const rows = (await frame()).split("\n")
    const y = rows.findIndex((row) => row.includes(label))
    expect(y).toBeGreaterThanOrEqual(0)
    await act(async () => {
      await mockMouse.click((rows[y] ?? "").indexOf(label) + 1, y)
    })
    expect(calls.at(-1)).toBe(expected)
  }
  expect(calls).toEqual(["retry", "settings", "another"])
})

test("an unrecorded code still states that the engine exited", async () => {
  const { frame } = await mount(exitProps(null))
  await settle(200)
  const output = await frame()
  expect(output).toContain("Engine exited")
  expect(output).not.toContain("code")
})

test("F5 is Retry while the strip is up, with no kill-the-shell confirm", async () => {
  calls.length = 0
  const { frame, mockInput } = await mount(exitProps(1))
  await settle(200)
  mockInput.pressKey("\x1b[15~")
  await settle(300)
  expect(calls).toEqual(["retry"])
  expect(await frame()).not.toContain("kill")
})
