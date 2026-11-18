import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RemoteOrchestrator } from "../../src/client/remote-orchestrator"

describe("RemoteOrchestrator read methods", () => {
  let orch: RemoteOrchestrator
  beforeEach(() => {
    orch = new RemoteOrchestrator(new RoveDaemonClient("/unused-read-test.sock"))
  })
  afterEach(() => orch.dispose())

  it.each([
    "tasksSignal",
    "activeTaskSignal",
    "updateSignal",
    "daemonVersionSignal",
    "daemonStaleSignal",
    "daemonRestartingSignal",
    "engineStateSignal",
    "engineTabStatesSignal",
    "attentionInboxSignal",
    "taskJobsSignal",
    "worktreeChangesSignal",
    "usageSnapshotSignal",
    "contextUsageSignal",
    "transcriptActivitySignal",
    "uiPrefsSignal",
    "keybindingsRevSignal",
  ] as const)("%s stays bound when handed to a consumer and returns a stable cell", (name) => {
    const read = orch[name]
    const state = read()
    expect(read()).toBe(state)
    expect(state()).toBe(state.get())
  })

  it("unbound list/get/store readers resolve against the same cells", () => {
    const { listTasks, getTask, transcriptActivityStore, uiPrefsStore, keybindingsRevStore } = orch
    expect(listTasks()).toBe(orch.tasksSignal()())
    expect(getTask("missing")).toBeUndefined()
    expect(transcriptActivityStore()).toBe(orch.transcriptActivitySignal())
    expect(uiPrefsStore()).toBe(orch.uiPrefsSignal())
    expect(keybindingsRevStore()).toBe(orch.keybindingsRevSignal())
  })
})
