/**
 * Boundary test over the real daemon socket: `archive` hides a task and its child
 * from `list`; `send` still delivers and reports `archived: true` + `warning` while
 * keeping them hidden; `send --unarchive` restores the subtree so `list` shows them again.
 */

import { invokeVerb } from "@sma1lboy/rove-api/cli/api-cmd.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { afterEach, describe, expect, it } from "vitest"
import { recordingDelivery, stubRuntime } from "../cli/api-handler-fixtures.ts"
import { TASK } from "./handler-test-context.ts"
import { type DaemonHarness, bootDaemonHarness, fakeOrchestrator } from "./harness.ts"

describe("send to an archived task over the daemon socket", () => {
  let h: DaemonHarness

  afterEach(async () => {
    await h.close()
  })

  it("warns and stays hidden on plain send, then becomes visible in list again with --unarchive", async () => {
    const tasks: Task[] = [
      { ...TASK, id: "parent-1", title: "Parent" } as Task,
      { ...TASK, id: "child-1", title: "Child", parentTaskId: "parent-1" } as Task,
    ]
    h = await bootDaemonHarness({
      orchestrator: fakeOrchestrator({
        listTasks: () => tasks.map((t) => ({ ...t })),
        getTask: (id: string) => {
          const found = tasks.find((t) => t.id === id)
          return found ? { ...found } : undefined
        },
        setArchived: async (id: string, archived: boolean) => {
          const found = tasks.find((t) => t.id === id)
          if (found) (found as { archived?: boolean }).archived = archived
        },
      }),
    })

    const client = h.client()
    const { calls, deliver } = recordingDelivery({ started: true })
    const runtime = stubRuntime({ deliverPrompt: deliver })

    await invokeVerb("archive", ["--task-id", "parent-1"], { client, runtime })
    const hidden = (await invokeVerb("list", [], { client, runtime })) as { tasks: Array<{ id: string }> }
    expect(hidden.tasks).toEqual([])
    const archivedList = (await invokeVerb("list", ["--archived"], { client, runtime })) as {
      tasks: Array<{ id: string }>
    }
    expect(archivedList.tasks.map((t) => t.id)).toEqual(["parent-1", "child-1"])

    const sent = (await invokeVerb("send", ["--task-id", "parent-1", "--prompt", "still archived"], {
      client,
      runtime,
    })) as Record<string, unknown>
    expect(calls).toHaveLength(1)
    expect(sent.delivered).toBe(true)
    expect(sent.archived).toBe(true)
    expect(sent.warning).toBe(
      "task parent-1 is archived: the message was delivered and its engine restarted, but the task stays hidden; pass --unarchive to bring it back",
    )
    const stillHidden = (await invokeVerb("list", [], { client, runtime })) as { tasks: Array<{ id: string }> }
    expect(stillHidden.tasks).toEqual([])

    const restored = (await invokeVerb("send", ["--task-id", "parent-1", "--unarchive", "--prompt", "bring it back"], {
      client,
      runtime,
    })) as Record<string, unknown>
    expect(calls).toHaveLength(2)
    expect(restored.delivered).toBe(true)
    expect(restored.unarchived).toBe(true)
    expect(restored.archived).toBeUndefined()
    expect(restored.warning).toBeUndefined()

    const visible = (await invokeVerb("list", [], { client, runtime })) as { tasks: Array<{ id: string }> }
    expect(visible.tasks.map((t) => t.id)).toEqual(["parent-1", "child-1"])
  })
})
