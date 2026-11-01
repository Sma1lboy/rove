/**
 * Plain `send` against a real daemon: a paste is text plus Enter, and Enter into a menu approves its
 * highlighted option. A stray turn-complete reported while the menu is still drawn must not make the tab
 * look sendable (the queue refuses the same edge).
 */

import { afterEach, describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { recordingDelivery, stubRuntime, taskFixture } from "../cli/api-handler-fixtures.ts"
import { type DaemonHarness, bootDaemonHarness, fakeOrchestrator } from "./harness.ts"

const TASK = taskFixture({ id: "t1" })

describe("plain send at an approval menu", () => {
  let h: DaemonHarness | null = null
  afterEach(async () => {
    await h?.close()
    h = null
  })

  async function boot() {
    h = await bootDaemonHarness({
      orchestrator: fakeOrchestrator({ getTask: () => TASK, listTasks: () => [TASK] }),
    })
    const client = h.client()
    const report = (kind: string) => client.request("engine.reportEvent", { taskId: "t1", tabId: "tab-1", kind })
    const send = async () => {
      const delivery = recordingDelivery()
      const run = invokeVerb("send", ["--task-id", "t1", "--tab", "tab-1", "--plain", "--prompt", "4"], {
        client,
        runtime: stubRuntime({ deliverPrompt: delivery.deliver }),
      })
      return { run, delivery }
    }
    return { report, send }
  }

  it("refuses after a stray turn-complete over a menu, pastes nothing, and sends once a turn really ran", async () => {
    const { report, send } = await boot()
    await report("turn-start")
    await report("awaiting-input")
    await report("turn-complete")

    const stray = await send()
    await expect(stray.run).rejects.toMatchObject({ code: "AWAITING_PERMISSION" })
    expect(stray.delivery.calls).toHaveLength(0)

    // The menu was answered: the engine works and finishes, so the rest is confirmed.
    await report("turn-start")
    await report("turn-complete")
    const settled = await send()
    await settled.run
    expect(settled.delivery.calls).toHaveLength(1)
  })

  it("still pastes into a tab that came to rest after a normal turn", async () => {
    const { report, send } = await boot()
    await report("turn-start")
    await report("turn-complete")
    const ok = await send()
    await ok.run
    expect(ok.delivery.calls).toHaveLength(1)
  })
})
