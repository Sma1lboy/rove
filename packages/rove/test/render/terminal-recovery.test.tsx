/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import { MockTaskPty } from "../../src/tui/panes/terminal/pty-mock"
import { PtyRegistry } from "../../src/tui/panes/terminal/registry"
import type { SessionRecovery } from "../../src/tui/panes/terminal/session-recovery"
import { act, renderComponent } from "./harness"

for (const [state, message] of [
  ["live", "Live process reattached"],
  ["relaunched", "Command relaunched in a new process"],
  ["restored", "Historical screen restored; previous process ended"],
] as const) {
  test(`terminal presents ${state} evidence without claiming conversation resumption`, async () => {
    class RecoveryPty extends MockTaskPty {
      onRecovery(listener: (value: SessionRecovery) => void) {
        listener(state)
        return () => {}
      }
    }
    const registry = new PtyRegistry((opts) => new RecoveryPty(opts))
    const { frame } = await renderComponent(
      <Terminal cwd="/fixture" taskId={`recovery-${state}`} focused registry={registry} />,
      { width: 100, height: 16, providers: { dialog: true } },
    )
    await act(async () => {})
    const output = (await frame()).replace(/\s+/g, " ")
    expect(output).toContain(message)
    expect(output).not.toContain("conversation resumed")
  })
}

test("switching back to a live PTY keeps its size: the banner row is laid out before the body is measured", async () => {
  class LivePty extends MockTaskPty {
    /** Size changes only: a same-size resize raises no SIGWINCH. */
    readonly resizes: string[] = []
    private last = ""
    currentRecovery(): SessionRecovery {
      return "live"
    }
    onRecovery(listener: (value: SessionRecovery) => void) {
      listener("live")
      return () => {}
    }
    override resize(cols: number, rows: number): void {
      const next = `${cols}x${rows}`
      if (next !== this.last) this.resizes.push(next)
      this.last = next
      super.resize(cols, rows)
    }
  }
  let pty: LivePty | null = null
  const registry = new PtyRegistry((opts) => {
    pty = new LivePty(opts)
    return pty
  })
  const ui = <Terminal cwd="/fixture" taskId="recovery-switch" focused registry={registry} />
  const first = await renderComponent(ui, { width: 100, height: 16, providers: { dialog: true } })
  await act(async () => {})
  first.destroy()
  const live = pty as LivePty | null
  if (!live) throw new Error("no pty acquired")
  live.resizes.length = 0

  const second = await renderComponent(ui, { width: 100, height: 16, providers: { dialog: true } })
  await act(async () => {})
  expect((await second.frame()).replace(/\s+/g, " ")).toContain("Live process reattached")
  expect(live.resizes).toEqual([])
})
