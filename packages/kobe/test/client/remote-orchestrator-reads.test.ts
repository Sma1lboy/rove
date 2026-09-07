import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { expect, it } from "vitest"
import { RemoteOrchestrator } from "../../src/client/remote-orchestrator"

it("read methods stay bound when handed to a consumer and return stable state cells", () => {
  const client = new KobeDaemonClient("/unused-read-test.sock")
  const orch = new RemoteOrchestrator(client)
  try {
    const readers = [
      orch.tasksSignal,
      orch.activeTaskSignal,
      orch.updateSignal,
      orch.daemonVersionSignal,
      orch.daemonStaleSignal,
      orch.daemonRestartingSignal,
      orch.engineStateSignal,
      orch.engineTabStatesSignal,
      orch.attentionInboxSignal,
      orch.taskJobsSignal,
      orch.worktreeChangesSignal,
      orch.usageSnapshotSignal,
      orch.contextUsageSignal,
      orch.transcriptActivitySignal,
      orch.uiPrefsSignal,
      orch.keybindingsRevSignal,
    ]
    for (const read of readers) {
      const state = read()
      expect(read()).toBe(state)
      expect(state()).toBe(state.get())
    }
    const { listTasks, getTask, transcriptActivityStore, uiPrefsStore, keybindingsRevStore } = orch
    expect(listTasks()).toBe(orch.tasksSignal()())
    expect(getTask("missing")).toBeUndefined()
    expect(transcriptActivityStore()).toBe(orch.transcriptActivitySignal())
    expect(uiPrefsStore()).toBe(orch.uiPrefsSignal())
    expect(keybindingsRevStore()).toBe(orch.keybindingsRevSignal())
  } finally {
    orch.dispose()
  }
})
