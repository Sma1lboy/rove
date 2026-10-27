/** `tab-revive --restart-exited`: the verb relaunches a session only on positive proof its engine is gone. */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import type { TaskTabRow } from "../../src/cli/api/tab-snapshot.ts"
import { FakeClient, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const tab = (extra: Partial<TaskTabRow>): TaskTabRow =>
  ({ id: "tab-1", kind: "engine", alive: true, ...extra }) as TaskTabRow

async function revive(args: string[], rows: TaskTabRow[]) {
  const asked: Array<{ replaceExited?: boolean } | undefined> = []
  const client = new FakeClient({
    "task.get": () => ({ task: taskFixture() }),
    "task.list": () => ({ tasks: [taskFixture()] }),
  })
  await invokeVerb("tab-revive", ["--task-id", "t1", "--tab", "tab-1", ...args], {
    client,
    runtime: stubRuntime({
      taskTabs: async () => ({ tabs: rows, running: true }),
      reviveTab: async (_client, _target, _tabId, _worktree, opts) => {
        asked.push(opts)
        return { revived: true, resumed: false }
      },
    }),
  })
  return asked
}

describe("tab-revive --restart-exited", () => {
  it("replaces a running session whose engine process is gone", async () => {
    expect(await revive(["--restart-exited"], [tab({ engineAlive: false })])).toEqual([{ replaceExited: true }])
  })

  it("leaves a session alone while an engine runs in it, or while no walk could say", async () => {
    expect(await revive(["--restart-exited"], [tab({ engineAlive: true })])).toEqual([{ replaceExited: false }])
    expect(await revive(["--restart-exited"], [tab({ engineAlive: null })])).toEqual([{ replaceExited: false }])
  })

  it("never replaces a running shell tab", async () => {
    expect(await revive(["--restart-exited"], [tab({ kind: "command", engineAlive: false })])).toEqual([
      { replaceExited: false },
    ])
  })

  it("without the flag a running session with a dead engine is still left alone", async () => {
    expect(await revive([], [tab({ engineAlive: false })])).toEqual([{ replaceExited: false }])
  })
})

describe("tab-revive --restart-updated", () => {
  async function restartUpdated(rows: TaskTabRow[], state?: string) {
    const asked: Array<{ replaceExited?: boolean } | undefined> = []
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture() }),
      "task.list": () => ({ tasks: [taskFixture()] }),
      "debug.inspect": () => ({ activity: { tasks: {}, tabs: state ? { t1: { "tab-1": { state, at: 0 } } } : {} } }),
    })
    const out = (await invokeVerb("tab-revive", ["--task-id", "t1", "--tab", "tab-1", "--restart-updated"], {
      client,
      runtime: stubRuntime({
        taskTabs: async () => ({ tabs: rows, running: true }),
        reviveTab: async (_client, _target, _tabId, _worktree, opts) => {
          asked.push(opts)
          return { revived: opts?.replaceExited === true, resumed: opts?.replaceExited === true }
        },
      }),
    })) as { busy?: string }
    return { asked, busy: out.busy }
  }

  const updated = tab({ engineAlive: true, engineUpdated: true } as Partial<TaskTabRow>)

  it("relaunches an engine running an older CLI once its turn is over", async () => {
    expect(await restartUpdated([updated], "turn_complete")).toEqual({
      asked: [{ replaceExited: true }],
      busy: undefined,
    })
  })

  it("never kills a turn in progress, a prompt waiting on you, or an engine whose state is unknown", async () => {
    expect(await restartUpdated([updated], "running")).toEqual({ asked: [{ replaceExited: false }], busy: "running" })
    expect((await restartUpdated([updated], "permission_needed")).busy).toBe("permission_needed")
    expect((await restartUpdated([updated])).busy).toBe("unknown")
  })

  it("leaves an engine on the current CLI, or one it could not check, alone", async () => {
    const current = tab({ engineAlive: true, engineUpdated: false } as Partial<TaskTabRow>)
    const unknown = tab({ engineAlive: true, engineUpdated: null } as Partial<TaskTabRow>)
    expect((await restartUpdated([current], "idle")).asked).toEqual([{ replaceExited: false }])
    expect((await restartUpdated([unknown], "idle")).asked).toEqual([{ replaceExited: false }])
  })
})
