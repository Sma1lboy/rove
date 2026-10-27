/**
 * `update --parent` — move an existing task under another without touching what runs in it.
 *
 * The caller relies on three things: afterwards the moved task's bare `send` reaches the new parent's
 * live engine tab (the tree link AND the reply address moved together); the task's engine, tab and
 * checkout fields are byte-identical; and every move that would corrupt the tree is refused with a
 * typed code and leaves every row as it was. Runs the real orchestrator + store behind the verb.
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serializeTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { type SelfSessionProbe, resetVerifiedSelfSession, verifiedSelfSession } from "../../src/cli/api/dispatcher.ts"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import type { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import type { Task, TaskId } from "../../src/types/task.ts"
import { FakeClient, expectApiError, recordingDelivery, stubRuntime } from "./api-handler-fixtures.ts"

const DURABLE_WRITE_TIMEOUT_MS = 30_000

let home: string
let store: TaskIndexStore
let orch: Orchestrator
let client: FakeClient

const savedTaskId = process.env.ROVE_TASK_ID
const savedTabId = process.env.ROVE_TAB_ID

/** The caller is a verified session inside `taskId`'s `tabId` (no real pty/ps IO). */
async function asSession(taskId: string, tabId: string): Promise<void> {
  const probe: SelfSessionProbe = {
    pid: 500,
    sessions: async () => [{ key: `${taskId}::${tabId}`, pid: 100, alive: true }],
    ps: async () => ["  100     1 /bin/zsh -il", "  200   100 claude", "  500   200 bun rove api send"].join("\n"),
  }
  await verifiedSelfSession({ ROVE_TASK_ID: taskId, ROVE_TAB_ID: tabId }, probe)
}

async function makeTask(fields: Partial<Task> = {}): Promise<Task> {
  return store.create({
    kind: "task",
    title: "T",
    repo: "/repo/x",
    branch: "rove/t",
    worktreePath: "/wt/t",
    status: "backlog",
    vendor: "claude",
    ...fields,
  })
}

const row = (id: string): Task => {
  const task = orch.getTask(id)
  if (!task) throw new Error(`no task ${id}`)
  return task
}

/** A row without the fields a re-parent is allowed to change. */
function untouched(task: Task): Record<string, unknown> {
  const { parentTaskId: _p, dispatcher: _d, updatedAt: _u, ...rest } = task
  return rest
}

const runtimeWithEngineOn = (taskId: string, tabId: string) =>
  stubRuntime({
    taskTabs: async (id) => ({
      tabs:
        id === taskId
          ? [{ id: "tab-1", kind: "shell", alive: true } as never, { id: tabId, kind: "engine", alive: true } as never]
          : [],
      running: id === taskId,
    }),
  })

beforeEach(async () => {
  resetVerifiedSelfSession()
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.ROVE_TASK_ID
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.ROVE_TAB_ID
  home = await mkdtemp(join(tmpdir(), "rove-reparent-"))
  store = new TaskIndexStore({ homeDir: home })
  await store.load()
  orch = new Orchestrator({ store, worktrees: {} as unknown as GitWorktreeManager })
  client = new FakeClient({
    "task.get": (payload) => {
      const task = orch.getTask((payload as { taskId: string }).taskId)
      if (!task) throw new Error("task not found")
      return { task: serializeTask(task) }
    },
    "task.list": () => ({ tasks: orch.listTasks().map(serializeTask) }),
    "task.setParent": (payload) => {
      const { taskId, parentTaskId, replyTab } = payload as {
        taskId: string
        parentTaskId: string | null
        replyTab?: string
      }
      return orch.setParent(taskId, parentTaskId, replyTab)
    },
  })
})

afterEach(async () => {
  orch.dispose()
  await rm(home, { recursive: true, force: true })
  resetVerifiedSelfSession()
  for (const [name, saved] of [
    ["ROVE_TASK_ID", savedTaskId],
    ["ROVE_TAB_ID", savedTabId],
  ] as const) {
    if (saved === undefined) {
      delete process.env[name]
    } else process.env[name] = saved
  }
})

describe("update --parent", () => {
  it(
    "moves the tree link AND the reply address: the task's bare send reaches the new parent's live engine tab",
    async () => {
      const coordinator = await makeTask({ title: "old coordinator" })
      const newParent = await makeTask({ title: "new parent", worktreePath: "/wt/p", branch: "rove/p" })
      const worker = await makeTask({
        title: "worker",
        worktreePath: "/wt/w",
        branch: "rove/w",
        command: "codex --search",
        dispatcher: { taskId: coordinator.id, tabId: "tab-1" },
      })
      const before = untouched(row(worker.id))

      await invokeVerb("update", ["--task-id", worker.id, "--parent", newParent.id], {
        client,
        runtime: runtimeWithEngineOn(newParent.id, "tab-2"),
      })

      expect(row(worker.id).parentTaskId).toBe(newParent.id)
      expect(row(worker.id).dispatcher).toEqual({ taskId: newParent.id, tabId: "tab-2" })
      // Engine, checkout and branch are exactly what they were; only the daemon rows named below were touched.
      expect(untouched(row(worker.id))).toEqual(before)
      // Reads aside, the move is the only write the verb made.
      expect(client.requestNames.filter((name) => name !== "task.get" && name !== "task.list")).toEqual([
        "task.setParent",
      ])

      // The worker, speaking from inside its own tab, now replies to the NEW parent's engine tab.
      resetVerifiedSelfSession()
      await asSession(worker.id, "tab-9")
      const { calls, deliver } = recordingDelivery()
      await invokeVerb("send", ["--prompt", "succeeded: done"], {
        client,
        runtime: { ...runtimeWithEngineOn(newParent.id, "tab-2"), deliverPrompt: deliver },
      })
      expect(calls[0]?.target).toMatchObject({ id: newParent.id, tab: "tab-2" })
    },
    DURABLE_WRITE_TIMEOUT_MS,
  )

  it(
    "`none` makes the task top level and drops a reply address that pointed into its old tree",
    async () => {
      const parent = await makeTask({ title: "parent" })
      const worker = await makeTask({
        title: "worker",
        parentTaskId: parent.id as TaskId,
        dispatcher: { taskId: parent.id, tabId: "tab-1" },
      })

      await invokeVerb("update", ["--task-id", worker.id, "--parent", "none"], { client, runtime: stubRuntime() })

      expect(row(worker.id).parentTaskId).toBeUndefined()
      expect(row(worker.id).dispatcher).toBeUndefined()
    },
    DURABLE_WRITE_TIMEOUT_MS,
  )

  it(
    "`none` keeps a reply address that was never the old tree's",
    async () => {
      const parent = await makeTask({ title: "parent" })
      const other = await makeTask({ title: "other coordinator", worktreePath: "/wt/o", branch: "rove/o" })
      const worker = await makeTask({
        title: "worker",
        parentTaskId: parent.id as TaskId,
        dispatcher: { taskId: other.id, tabId: "tab-3" },
      })

      await invokeVerb("update", ["--task-id", worker.id, "--parent", "none"], { client, runtime: stubRuntime() })

      expect(row(worker.id).parentTaskId).toBeUndefined()
      expect(row(worker.id).dispatcher).toEqual({ taskId: other.id, tabId: "tab-3" })
    },
    DURABLE_WRITE_TIMEOUT_MS,
  )

  it(
    "hangs under the target's top-level ancestor and carries the task's own children along",
    async () => {
      const root = await makeTask({ title: "root" })
      const sibling = await makeTask({
        title: "sibling",
        worktreePath: "/wt/s",
        branch: "rove/s",
        parentTaskId: root.id as TaskId,
      })
      const moving = await makeTask({ title: "moving", worktreePath: "/wt/m", branch: "rove/m" })
      const kid = await makeTask({
        title: "kid",
        worktreePath: "/wt/k",
        branch: "rove/k",
        parentTaskId: moving.id as TaskId,
      })

      const out = (await invokeVerb("update", ["--task-id", moving.id, "--parent", sibling.id], {
        client,
        runtime: stubRuntime(),
      })) as { parent: { parentTaskId: string; moved: string[] } }

      // Children never nest: the stored parent is the root, the reply address is the sibling that was asked for.
      expect(row(moving.id).parentTaskId).toBe(root.id)
      expect(row(moving.id).dispatcher?.taskId).toBe(sibling.id)
      expect(row(kid.id).parentTaskId).toBe(root.id)
      expect(out.parent.moved).toEqual([kid.id])
    },
    DURABLE_WRITE_TIMEOUT_MS,
  )

  it(
    "refuses a move that would break the tree, with a typed code and every row untouched",
    async () => {
      const top = await makeTask({ title: "top" })
      const child = await makeTask({
        title: "child",
        worktreePath: "/wt/c",
        branch: "rove/c",
        parentTaskId: top.id as TaskId,
      })
      const main = await makeTask({ kind: "main", title: "x", branch: "", worktreePath: "/repo/x" })
      const remote = await makeTask({
        title: "remote",
        repo: "ssh://dev@box/work/x",
        worktreePath: "/r/w",
        branch: "rove/r",
      })
      const snapshot = JSON.stringify(orch.listTasks())

      const refused = async (args: string[], code: string): Promise<void> =>
        expectApiError(() => invokeVerb("update", args, { client, runtime: stubRuntime() }), code)

      await refused(["--task-id", top.id, "--parent", top.id], "PARENT_IS_SELF")
      await refused(["--task-id", top.id, "--parent", child.id], "PARENT_CYCLE")
      await refused(["--task-id", top.id, "--parent", "01NOSUCHTASKONTHISMACHINE"], "PARENT_NOT_FOUND")
      await refused(["--task-id", main.id, "--parent", top.id], "TASK_NOT_MOVABLE")
      await refused(["--task-id", child.id, "--parent", remote.id], "REMOTE_PARENT_UNSUPPORTED")
      await refused(["--task-id", remote.id, "--parent", top.id], "REMOTE_PARENT_UNSUPPORTED")
      // A refused move comes first: the (unrevertable) branch rename beside it is never attempted.
      await refused(["--task-id", top.id, "--parent", child.id, "--branch", "feat/x"], "PARENT_CYCLE")
      expect(client.requestNames).not.toContain("task.setBranch")

      expect(JSON.stringify(orch.listTasks())).toBe(snapshot)
    },
    DURABLE_WRITE_TIMEOUT_MS,
  )

  it(
    "moves a whole fan-out round with --group, recording a refusal per member instead of stopping",
    async () => {
      const parent = await makeTask({ title: "parent" })
      const a = await makeTask({ title: "a #1/2", worktreePath: "/wt/a", branch: "rove/a", groupId: "round-1" })
      const b = await makeTask({ title: "b #2/2", worktreePath: "/wt/b", branch: "rove/b", groupId: "round-1" })

      const out = (await invokeVerb("update", ["--group", "round-1", "--parent", parent.id], {
        client,
        runtime: stubRuntime(),
      })) as { ok: boolean; count: number; failures: number }

      expect(out).toMatchObject({ ok: true, count: 2, failures: 0 })
      expect(row(a.id).parentTaskId).toBe(parent.id)
      expect(row(b.id).parentTaskId).toBe(parent.id)
    },
    DURABLE_WRITE_TIMEOUT_MS,
  )

  it(
    "--group refuses a parent inside the round before moving anything",
    async () => {
      const a = await makeTask({ title: "a", worktreePath: "/wt/a", branch: "rove/a", groupId: "round-1" })
      const b = await makeTask({ title: "b", worktreePath: "/wt/b", branch: "rove/b", groupId: "round-1" })

      await expectApiError(
        () => invokeVerb("update", ["--group", "round-1", "--parent", a.id], { client, runtime: stubRuntime() }),
        "PARENT_IN_GROUP",
      )
      expect(row(b.id).parentTaskId).toBeUndefined()
      expect(client.requestNames).not.toContain("task.setParent")
    },
    DURABLE_WRITE_TIMEOUT_MS,
  )
})
