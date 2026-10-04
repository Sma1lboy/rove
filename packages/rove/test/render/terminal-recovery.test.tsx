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
