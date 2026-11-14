/** @jsxImportSource @opentui/react */
/**
 * A dead engine leaves a live keepAlive shell, so the pane cannot tell on its
 * own. The strip appears only when the host passes positive evidence
 * (`engineExit`), and every way out it names must be reachable by a click.
 */
import { beforeEach, expect, test } from "bun:test"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import type { EngineExit, UsageLimit } from "../../src/tui-react/panes/terminal/engine-exit-banner"
import { MockTaskPty } from "../../src/tui/panes/terminal/pty-mock"
import { PtyRegistry } from "../../src/tui/panes/terminal/registry"
import { type RenderHandle, act, isolateHome, renderComponent, settle, waitForFrameText } from "./harness"

isolateHome()

function mount(engineExit?: EngineExit, usageLimit?: UsageLimit) {
  const registry = new PtyRegistry((opts) => new MockTaskPty(opts))
  return renderComponent(
    <Terminal
      cwd="/fixture"
      taskId="engine-exit"
      focused
      registry={registry}
      engineExit={engineExit}
      usageLimit={usageLimit}
    />,
    { width: 110, height: 16, providers: { dialog: true, kv: true, notifications: true } },
  )
}

const calls: string[] = []
beforeEach(() => {
  calls.length = 0
})

/** Poll `check` with a cap: F5 travels the key parser before Retry fires. */
async function until(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) await settle(25)
}

/** Click the strip action labelled `label`. */
async function clickLabel({ frame, mockMouse }: RenderHandle, label: string): Promise<void> {
  const rows = (await frame()).split("\n")
  const y = rows.findIndex((row) => row.includes(label))
  expect(y).toBeGreaterThanOrEqual(0)
  await act(async () => {
    await mockMouse.click((rows[y] ?? "").indexOf(label) + 1, y)
  })
}
const exitProps = (code: number | null): EngineExit => ({
  code,
  onRetry: () => calls.push("retry"),
  onSettings: () => calls.push("settings"),
  onAnotherEngine: () => calls.push("another"),
  onContinueInEngine: () => calls.push("continue"),
})

test("a healthy engine draws no exit strip", async () => {
  const { frame } = await mount()
  await act(async () => {})
  const output = await frame()
  expect(output).not.toContain("Engine exited")
  expect(output).not.toContain("[Retry]")
})

test("the exit strip names the code and each action fires on click", async () => {
  const strip = await mount(exitProps(127))
  await waitForFrameText(strip.frame, "Engine exited (code 127)")

  await clickLabel(strip, "[Retry]")
  await clickLabel(strip, "[Settings → Engines]")
  await clickLabel(strip, "[Another engine]")
  await clickLabel(strip, "[Continue in another engine]")
  expect(calls).toEqual(["retry", "settings", "another", "continue"])
})

test("an unrecorded code still states that the engine exited", async () => {
  const { frame } = await mount(exitProps(null))
  const output = await waitForFrameText(frame, "Engine exited")
  expect(output).toContain("Engine exited")
  expect(output).not.toContain("code")
})

test("F5 is Retry while the strip is up, with no kill-the-shell confirm", async () => {
  const { frame, mockInput } = await mount(exitProps(1))
  await waitForFrameText(frame, "Engine exited")
  mockInput.pressKey("\x1b[15~")
  await until(() => calls.length > 0)
  expect(calls).toEqual(["retry"])
  expect(await frame()).not.toContain("kill")
})

test("a usage limit offers continue and dismiss by click, and the dead-engine strip outranks it", async () => {
  const limit: UsageLimit = {
    onContinueInEngine: () => calls.push("limit-continue"),
    onDismiss: () => calls.push("limit-dismiss"),
  }
  const banner = await mount(undefined, limit)
  await waitForFrameText(banner.frame, "Usage limit reached")
  await clickLabel(banner, "[Continue in another engine]")
  await clickLabel(banner, "[Dismiss]")
  expect(calls).toEqual(["limit-continue", "limit-dismiss"])

  const both = await mount(exitProps(1), limit)
  const output = await waitForFrameText(both.frame, "Engine exited")
  expect(output).toContain("Engine exited")
  expect(output).not.toContain("Usage limit reached")
})
