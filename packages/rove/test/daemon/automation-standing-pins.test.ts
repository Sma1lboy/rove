import { describe, expect, it } from "vitest"
import type { Automation, DaemonTask } from "../../../rove-daemon/src/daemon/contracts.ts"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import { engineLaunchArgv } from "../../src/engine/engine-presets.ts"
import { bootDaemonHarness, fakeOrchestrator } from "./harness.ts"

const REPO = process.cwd()

describe("standing routine pin updates through daemon RPC", () => {
  it.each([
    { name: "replace both", initial: { model: "gpt-5.5", effort: "low" }, patch: { model: "gpt-5.4", effort: "high" } },
    { name: "replace model", initial: { model: "gpt-5.5" }, patch: { model: "gpt-5.4" } },
    { name: "replace effort", initial: { effort: "low" }, patch: { effort: "high" } },
    { name: "add pins", initial: {}, patch: { model: "gpt-5.4", effort: "high" } },
    { name: "clear model", initial: { model: "gpt-5.5" }, patch: { model: null } },
    { name: "clear effort", initial: { effort: "low" }, patch: { effort: "" } },
    { name: "clear both", initial: { model: "gpt-5.5", effort: "low" }, patch: { model: "", effort: null } },
    { name: "change vendor", initial: {}, patch: { vendor: "claude" } },
    { name: "clear vendor", initial: {}, patch: { vendor: null } },
    {
      name: "change pins while switching to fresh",
      initial: {},
      patch: { model: "gpt-5.4", persistentSession: false },
    },
  ])(
    "$name lets go of the standing task, and the next firing builds one on the new pins",
    async ({ initial, patch }) => {
      const tasks: DaemonTask[] = []
      let live = false
      const launches: (readonly string[])[] = []
      const h = await bootDaemonHarness({
        orchestrator: fakeOrchestrator({
          createTask: async (input: Partial<DaemonTask>) => {
            const task: DaemonTask = {
              title: "audit",
              branch: "routine/audit",
              status: "in_progress",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              ...input,
              id: `standing-${tasks.length + 1}`,
              repo: REPO,
              worktreePath: REPO,
            }
            tasks.push(task)
            return task
          },
          getTask: (id: string) => tasks.find((task) => task.id === id),
        }),
        server: {
          runtime: {
            ...daemonRuntime,
            startTaskSessionWithPrompt: async (_link: unknown, taskId: string) => {
              const task = tasks.find((candidate) => candidate.id === taskId)
              if (!task) throw new Error("missing standing task")
              launches.push(engineLaunchArgv({ vendor: task.vendor, model: task.model, effort: task.modelEffort }))
              live = true
              return { started: true }
            },
            deliverPromptToLiveEngineDetailed: async () =>
              live ? { outcome: "delivered", tabId: "tab-1" } : { outcome: "no-session" },
          },
        },
      })
      try {
        const c = h.client()
        const { automation: a } = await c.request<{ automation: Automation }>("automation.create", {
          name: "audit",
          repo: REPO,
          prompt: "audit",
          schedule: "0 9 * * *",
          enabled: false,
          persistentSession: true,
          vendor: "codex",
          ...initial,
        })
        expect(await c.request("automation.runNow", { id: a.id })).toEqual({ status: "dispatched" })
        // Repeating the pins it already has is not a re-pin: the session stays.
        const { automation: renamed } = await c.request<{ automation: Automation }>("automation.update", {
          id: a.id,
          name: "renamed",
          vendor: "codex",
          ...initial,
        })
        expect(renamed.sessionTaskId).toBe("standing-1")
        const updated = await c.request<{ automation: Automation; releasedSessionTaskId?: string }>(
          "automation.update",
          { id: a.id, ...patch },
        )
        expect(updated.releasedSessionTaskId).toBe("standing-1")
        expect(updated.automation.sessionTaskId).toBeUndefined()
        // A live engine on the old task is left alone, not reused.
        expect(await c.request("automation.runNow", { id: a.id })).toEqual({ status: "dispatched" })
        expect(tasks).toHaveLength(2)
        const { vendor, model, modelEffort } = updated.automation
        expect(launches[1]).toEqual(engineLaunchArgv({ vendor: vendor ?? "claude", model, effort: modelEffort }))
        expect(launches[1]).not.toEqual(launches[0])
      } finally {
        await h.close()
      }
    },
  )

  it("does not adopt a first-firing task whose pins were replaced while it was being created", async () => {
    const created: DaemonTask[] = []
    let releaseCreate = (): void => {}
    let createStarted = (): void => {}
    const creating = new Promise<void>((resolve) => {
      createStarted = resolve
    })
    const launches: (readonly string[])[] = []
    const h = await bootDaemonHarness({
      orchestrator: fakeOrchestrator({
        createTask: async (input: Partial<DaemonTask>) => {
          const task: DaemonTask = {
            title: "audit",
            branch: `routine/audit-${created.length}`,
            status: "in_progress",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ...input,
            id: `task-${created.length}`,
            repo: REPO,
            worktreePath: REPO,
          }
          created.push(task)
          if (created.length === 1) {
            createStarted()
            await new Promise<void>((resolve) => {
              releaseCreate = resolve
            })
          }
          return task
        },
        getTask: (id: string) => created.find((t) => t.id === id),
      }),
      server: {
        runtime: {
          ...daemonRuntime,
          startTaskSessionWithPrompt: async (_link: unknown, taskId: string) => {
            const task = created.find((t) => t.id === taskId)
            if (!task) throw new Error(`missing task ${taskId}`)
            launches.push(engineLaunchArgv({ vendor: task.vendor, model: task.model, effort: task.modelEffort }))
            return { started: true }
          },
          deliverPromptToLiveEngineDetailed: async () => ({ outcome: "no-session" }),
        },
      },
    })
    try {
      const c = h.client()
      const { automation: a } = await c.request<{ automation: Automation }>("automation.create", {
        name: "audit",
        repo: REPO,
        prompt: "audit",
        schedule: "0 9 * * *",
        enabled: false,
        persistentSession: true,
        vendor: "codex",
        model: "gpt-5.5",
        effort: "low",
      })
      const first = c.request("automation.runNow", { id: a.id })
      await creating
      const next = { vendor: "claude", model: "sonnet", effort: "high" }
      await c.request("automation.update", { id: a.id, ...next })
      releaseCreate()
      expect(await first).toEqual({ status: "skipped_cancelled" })
      const { automations } = await c.request<{ automations: Automation[] }>("automation.list", {})
      expect(automations.find((x) => x.id === a.id)?.sessionTaskId).toBeUndefined()

      expect(await c.request("automation.runNow", { id: a.id })).toEqual({ status: "dispatched" })
      expect(created).toHaveLength(2)
      expect(launches).toEqual([engineLaunchArgv({ vendor: "claude", model: "sonnet", effort: "high" })])
    } finally {
      await h.close()
    }
  })
})
