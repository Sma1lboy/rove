import { DaemonActivityRegistry } from "@sma1lboy/rove-daemon/daemon/activity-registry"
import { DaemonEventBus } from "@sma1lboy/rove-daemon/daemon/event-bus"
import { describe, expect, it } from "vitest"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

describe.each(["dead", "error", "rate_limited"] as const)("busy protection beside %s", (attention) => {
  it.each([
    ["awaiting-input", "tab-2", 1, 3],
    ["awaiting-input", undefined, 1, 3],
    ["awaiting-input", "tab-2", 3, 1],
    ["awaiting-input", undefined, 3, 1],
    ["turn-start", "tab-2", 1, 3],
    ["turn-start", undefined, 1, 3],
    ["turn-start", "tab-2", 3, 1],
    ["turn-start", undefined, 3, 1],
  ] as const)("blocks archive and rewind for %s in %s, timestamps %s/%s", async (kind, tabId, attentionAt, busyAt) => {
    let now = attentionAt
    const activity = new DaemonActivityRegistry(new DaemonEventBus(), 1000, () => now)
    const effects: string[] = []
    const { ctx } = fakeCtx({
      listTasks: () => [TASK],
      getTask: () => TASK,
      checkpointScope: () => ({ ownerId: TASK.id, sharerIds: [TASK.id] }),
      setArchived: async () => effects.push("archive"),
      rewindToCheckpoint: async () => {
        effects.push("rewind")
        return {}
      },
    })
    try {
      if (attention === "dead") activity.recordEngineDeath(TASK.id, "tab-1", { code: 1 }, now)
      else
        activity.report(
          TASK.id,
          "turn-failed",
          attention === "rate_limited" ? { failure: "rate_limit" } : undefined,
          "tab-1",
        )
      now = busyAt
      activity.report(TASK.id, kind, undefined, tabId)
      const realContext = { ...ctx, activity }
      await expect(dispatch("task.archive", { taskId: TASK.id, archived: true }, realContext)).rejects.toThrow(
        /^TASK_BUSY:/,
      )
      await expect(dispatch("task.rewind", { taskId: TASK.id, to: 1 }, realContext)).rejects.toThrow(/^TASK_BUSY:/)
      expect(effects).toEqual([])
      await dispatch("task.archive", { taskId: TASK.id, archived: true, force: true }, realContext)
      await dispatch("task.rewind", { taskId: TASK.id, to: 1, force: true }, realContext)
      expect(effects).toEqual(["archive", "rewind"])
    } finally {
      activity.close()
    }
  })
})
