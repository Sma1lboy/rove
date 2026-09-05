import { describe, expect, it } from "vitest"
import type { Automation } from "../../../kobe-daemon/src/daemon/contracts.ts"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import { bootDaemonHarness, fakeOrchestrator } from "./harness.ts"

const REPO = process.cwd()
const TARGET = { kind: "existing-tab", taskId: "external", tabId: "tab-2" }
const TASK = { id: "external", repo: REPO, worktreePath: REPO }

describe("routine target through real daemon RPC", () => {
  it("CRUD keeps absent versus null, validates merged mode, and manually delivers to the exact tab", async () => {
    const deliveries: unknown[] = []
    const h = await bootDaemonHarness({
      orchestrator: fakeOrchestrator({ getTask: (id: string) => (id === TASK.id ? TASK : undefined) } as never),
      server: {
        runtime: {
          ...daemonRuntime,
          deliverPromptToLiveEngineTabDetailed: async (target, prompt) => {
            deliveries.push({ target, prompt })
            return { outcome: "delivered", tabId: target.tabId }
          },
        },
      },
    })
    try {
      const c = h.client()
      const input = {
        name: "existing",
        repo: REPO,
        prompt: "sentinel",
        schedule: "0 9 * * *",
        enabled: false,
        target: TARGET,
      }
      const { automation: a } = await c.request<{ automation: Automation }>("automation.create", input)
      expect(a.target).toEqual(TARGET)
      const { automation: renamed } = await c.request<{ automation: Automation }>("automation.update", {
        id: a.id,
        name: "changed",
      })
      expect(renamed.target).toEqual(TARGET)
      for (const conflict of [{ vendor: "codex" }, { baseRef: "HEAD" }, { persistentSession: true }]) {
        await expect(c.request("automation.update", { id: a.id, ...conflict })).rejects.toThrow(/existing-tab target/)
        await expect(c.request("automation.create", { ...input, ...conflict })).rejects.toThrow(/existing-tab target/)
      }
      expect(await c.request("automation.runNow", { id: a.id })).toEqual({ status: "dispatched" })
      expect(deliveries).toEqual([
        { target: expect.objectContaining({ id: TASK.id, tabId: "tab-2" }), prompt: "sentinel" },
      ])
      const { automation: cleared } = await c.request<{ automation: Automation }>("automation.update", {
        id: a.id,
        target: null,
      })
      expect(cleared.target).toBeUndefined()
      await c.request("automation.update", { id: a.id, vendor: "codex" })
      await expect(c.request("automation.update", { id: a.id, target: TARGET })).rejects.toThrow(/existing-tab target/)
      const { automation: rebound } = await c.request<{ automation: Automation }>("automation.update", {
        id: a.id,
        vendor: null,
        target: TARGET,
      })
      expect(rebound.target).toEqual(TARGET)
      expect(rebound.vendor).toBeUndefined()
      const { automations } = await c.request<{ automations: Automation[] }>("automation.list", {})
      expect(automations).toContainEqual(rebound)
      await expect(c.request("automation.create", { ...input, repo: `${REPO}/../kobe-daemon` })).rejects.toThrow(
        /repo must match/,
      )
      await expect(
        c.request("automation.update", { id: a.id, target: { ...TARGET, taskId: "missing" } }),
      ).rejects.toThrow(/target task unavailable/)
      await expect(c.request("automation.update", { id: a.id, target: { ...TARGET, tabId: "new" } })).rejects.toThrow(
        /target must be/,
      )
    } finally {
      await h.close()
    }
  })
})
