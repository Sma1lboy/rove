/**
 * A routine's STANDING session: one task re-delivered into every
 * firing, instead of a fresh worktree + branch per run.
 *
 * The four paths a firing can take are here because they are the ones that
 * fail silently in production, and each fails DIFFERENTLY:
 *
 *   1. first firing      — build the task, mark it, remember its id
 *   2. live engine       — deliver into it (no second task, no second branch)
 *   3. dead engine       — respawn in the SAME worktree, recorded as `revived`
 *   4. task deleted      — self-heal by rebuilding, rather than failing forever
 *
 * (4) is the one worth the most: a stored task id whose task is gone would
 * otherwise wedge the routine permanently, and a wedged schedule looks exactly
 * like a schedule that is merely quiet.
 *
 * The composer-busy case is here for the same reason: dropping a routine's
 * daily report and never running at all are indistinguishable to the user, so
 * the prompt must end up owned by the deferred store, not on the floor.
 */

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { DaemonRpcClient } from "../../../kobe-daemon/src/client/rpc.ts"
import { type DispatchDeps, dispatchAutomation } from "../../../kobe-daemon/src/daemon/automation-dispatch.ts"
import { runAutomationOnce } from "../../../kobe-daemon/src/daemon/automation-runner.ts"
import { AutomationsStore } from "../../../kobe-daemon/src/daemon/automations-store.ts"
import type { Automation, DaemonTask } from "../../../kobe-daemon/src/daemon/contracts.ts"
import { DeferredPromptsStore } from "../../../kobe-daemon/src/daemon/deferred-prompts-store.ts"

const NOW = new Date(2026, 6, 31, 10, 0, 0).getTime()
const REPO = process.cwd()
const link = {} as DaemonRpcClient

function automation(over: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    name: "daily audit",
    repo: REPO,
    prompt: "what changed since yesterday?",
    schedule: "0 9 * * *",
    enabled: true,
    persistentSession: true,
    nextRunAt: new Date(NOW).toISOString(),
    missedRunGraceMinutes: 60,
    createdAt: new Date(NOW - 86_400_000).toISOString(),
    updatedAt: new Date(NOW - 86_400_000).toISOString(),
    ...over,
  }
}

function task(over: Partial<DaemonTask> = {}): DaemonTask {
  return {
    id: "task-1",
    title: "daily audit",
    repo: REPO,
    branch: "routine/daily-audit",
    worktreePath: "/wt/daily-audit",
    status: "in_progress",
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...over,
  } as DaemonTask
}

/** Records every call so a test can prove which path a firing actually took. */
function harness(
  args: {
    tasks?: Record<string, DaemonTask>
    deliver?: DispatchDeps["runtime"]["deliverPromptToLiveEngineDetailed"]
    startOk?: boolean
  } = {},
) {
  const created: unknown[] = []
  const spawned: Array<{ taskId: string; prompt: string }> = []
  const delivered: Array<{ taskId: string; prompt: string }> = []
  const deps: DispatchDeps = {
    orch: {
      createTask: async (input: never) => {
        created.push(input)
        return task({ id: `task-${created.length}` })
      },
      getTask: (id: string) => args.tasks?.[id],
    },
    runtime: {
      deliverPromptToLiveEngineTabDetailed: async () => {
        throw new Error("standing must not use bound-tab delivery")
      },
      startTaskSessionWithPrompt: async (_l: DaemonRpcClient, taskId: string, prompt: string) => {
        spawned.push({ taskId, prompt })
        return { started: args.startOk !== false }
      },
      deliverPromptToLiveEngineDetailed:
        args.deliver ??
        (async (t: { id: string }, prompt: string) => {
          delivered.push({ taskId: t.id, prompt })
          return { outcome: "delivered" as const, tabId: "tab-1" }
        }),
    },
    link: () => link,
    now: () => NOW,
  }
  return { created, spawned, delivered, deps }
}

describe("standing session — first firing", () => {
  it("creates ONE task, marks it as the routine's, and reports its id back", async () => {
    const { created, spawned, deps } = harness()

    const outcome = await dispatchAutomation(deps, automation())

    expect(created).toHaveLength(1)
    // The marker is what folds the task behind the sidebar's count row. Without
    // it the routine's task renders as an ordinary loose row — the exact noise
    // this issue exists to remove.
    expect(created[0]).toMatchObject({ repo: REPO, routine: { automationId: "auto-1" } })
    expect(spawned).toEqual([{ taskId: "task-1", prompt: "what changed since yesterday?" }])
    expect(outcome).toMatchObject({ status: "dispatched", taskId: "task-1", sessionTaskIdToSet: "task-1" })
  })

  it("does NOT mark a task when the routine is not persistent", async () => {
    const { created, deps } = harness()

    await dispatchAutomation(deps, automation({ persistentSession: false }))

    // A fresh-per-run routine makes ordinary tasks: its output is a branch the
    // user has to review and land, so hiding it would hide real work.
    expect(created[0]).not.toHaveProperty("routine")
  })

  it("remembers the task even when its engine failed to start", async () => {
    const { deps } = harness({ startOk: false })

    const outcome = await dispatchAutomation(deps, automation())

    // The worktree exists either way, so the NEXT firing must revive this task
    // rather than stack a second standing task beside it.
    expect(outcome).toMatchObject({ status: "dispatch_failed", taskId: "task-1", sessionTaskIdToSet: "task-1" })
  })
})

describe("standing session — later firings", () => {
  it("delivers into the live engine instead of creating a second task", async () => {
    const { created, delivered, spawned, deps } = harness({ tasks: { "task-1": task() } })

    const outcome = await dispatchAutomation(deps, automation({ sessionTaskId: "task-1" }))

    expect(created).toHaveLength(0)
    expect(spawned).toHaveLength(0)
    expect(delivered).toEqual([{ taskId: "task-1", prompt: "what changed since yesterday?" }])
    expect(outcome).toMatchObject({ status: "dispatched", taskId: "task-1" })
    expect(outcome.sessionTaskIdToSet).toBeUndefined()
  })

  it("respawns the same worktree when the engine died, recorded as revived", async () => {
    const { created, spawned, deps } = harness({
      tasks: { "task-1": task() },
      deliver: async () => ({ outcome: "no-session" as const }),
    })

    const outcome = await dispatchAutomation(deps, automation({ sessionTaskId: "task-1" }))

    expect(created).toHaveLength(0)
    expect(spawned).toEqual([{ taskId: "task-1", prompt: "what changed since yesterday?" }])
    // NOT `dispatched`: the files carried over but the conversation did not,
    // and a run that started over must not read like one that had context.
    expect(outcome).toMatchObject({ status: "revived", taskId: "task-1" })
  })

  it("rebuilds and relinks when the standing task was deleted", async () => {
    const { created, deps } = harness({ tasks: {} })

    const outcome = await dispatchAutomation(deps, automation({ sessionTaskId: "gone" }))

    expect(created).toHaveLength(1)
    expect(outcome).toMatchObject({
      status: "dispatched",
      taskId: "task-1",
      sessionTaskIdToSet: "task-1",
      sessionTaskIdToClear: true,
    })
  })

  it("rebuilds when the standing task is mid-deletion or lost its worktree", async () => {
    for (const broken of [task({ deletion: { at: NOW } as never }), task({ worktreePath: "" })]) {
      const { created, deps } = harness({ tasks: { "task-1": broken } })

      const outcome = await dispatchAutomation(deps, automation({ sessionTaskId: "task-1" }))

      expect(created).toHaveLength(1)
      expect(outcome.sessionTaskIdToSet).toBe("task-1")
    }
  })
})

describe("standing session — busy composer", () => {
  it("hands the report to the deferred store instead of dropping it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kobe-routine-defer-"))
    const deferred = new DeferredPromptsStore(join(dir, "deferred.json"), () => NOW)
    const episodes: Array<{ taskId: string; tabId: string; layer: string }> = []
    const { deps } = harness({
      tasks: { "task-1": task() },
      deliver: async () => ({ outcome: "busy" as const, tabId: "tab-2", layer: "composer-not-empty" as const }),
    })

    const outcome = await dispatchAutomation(
      {
        ...deps,
        deferred,
        inbox: {
          recordPromptDeferred: async (taskId, tabId, _id, layer) => {
            episodes.push({ taskId, tabId, layer })
          },
        },
      },
      automation({ sessionTaskId: "task-1" }),
    )

    // A SUCCESS: the daemon owns the text now. Reporting this as a failure
    // would send a human hunting for a broken routine that is working.
    expect(outcome).toMatchObject({ status: "deferred", taskId: "task-1" })
    const stored = await deferred.listForTask("task-1")
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ prompt: "what changed since yesterday?", tabId: "tab-2" })
    // The episode points at the tab the engine was actually found on, so
    // releasing it lands on the session that holds the conversation.
    expect(episodes).toEqual([{ taskId: "task-1", tabId: "tab-2", layer: "composer-not-empty" }])
  })

  it("reports a failure rather than losing the report when no store is wired", async () => {
    const { deps } = harness({
      tasks: { "task-1": task() },
      deliver: async () => ({ outcome: "busy" as const, tabId: "tab-1", layer: "recent-human-write" as const }),
    })

    const outcome = await dispatchAutomation(deps, automation({ sessionTaskId: "task-1" }))

    expect(outcome.status).toBe("dispatch_failed")
    expect(outcome.error).toContain("composer busy")
  })

  it("reports a failure instead of replacing an earlier deferred report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kobe-routine-defer-full-"))
    const deferred = new DeferredPromptsStore(join(dir, "deferred.json"), () => NOW)
    const first = await deferred.file({
      taskId: "task-1",
      tabId: "tab-1",
      prompt: "first report",
      layer: "composer-not-empty",
      at: NOW - 1,
    })
    const { deps } = harness({
      tasks: { "task-1": task() },
      deliver: async () => ({ outcome: "busy" as const, tabId: "tab-1", layer: "composer-not-empty" as const }),
    })
    const episodes: string[] = []

    const outcome = await dispatchAutomation(
      {
        ...deps,
        deferred,
        inbox: { recordPromptDeferred: async (_taskId, _tabId, id) => void episodes.push(id) },
      },
      automation({ sessionTaskId: "task-1" }),
    )

    expect(outcome).toMatchObject({ status: "dispatch_failed", taskId: "task-1" })
    expect(outcome.error).toContain(first.id)
    expect(await deferred.get(first.id)).toEqual(first)
    // If the first filing died after the record rename, this retry repairs
    // the missing Inbox pointer while still rejecting the newer report.
    expect(episodes).toEqual([first.id])
  })
})

describe("runAutomationOnce persists the standing link", () => {
  it("writes sessionTaskId on the first firing so the next one reuses it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kobe-routine-link-"))
    const store = new AutomationsStore(join(dir, "automations.json"), () => NOW)
    await store.init()
    const created = await store.create({
      name: "daily audit",
      repo: REPO,
      prompt: "what changed since yesterday?",
      schedule: "0 9 * * *",
      missedRunGraceMinutes: 60,
      persistentSession: true,
    })
    const { deps } = harness()

    const status = await runAutomationOnce(
      { store, orch: deps.orch, runtime: deps.runtime, link, now: () => NOW },
      created,
      { scheduledFor: NOW, trigger: "scheduled" },
    )

    expect(status).toBe("dispatched")
    expect(store.get(created.id)?.sessionTaskId).toBe("task-1")
    expect(store.runsFor(created.id)[0]).toMatchObject({ status: "dispatched", taskId: "task-1" })
  })

  it("clears a stale link so a deleted task cannot wedge the routine forever", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kobe-routine-stale-"))
    const store = new AutomationsStore(join(dir, "automations.json"), () => NOW)
    await store.init()
    const created = await store.create({
      name: "daily audit",
      repo: REPO,
      prompt: "p",
      schedule: "0 9 * * *",
      missedRunGraceMinutes: 60,
      persistentSession: true,
    })
    await store.update(created.id, { sessionTaskId: "deleted-task" })
    const { deps } = harness({ tasks: {} })

    await runAutomationOnce(
      { store, orch: deps.orch, runtime: deps.runtime, link, now: () => NOW },
      store.get(created.id) as Automation,
      {
        scheduledFor: NOW,
        trigger: "scheduled",
      },
    )

    // Relinked to the REBUILT task, not left pointing at the corpse.
    expect(store.get(created.id)?.sessionTaskId).toBe("task-1")
  })
})
