/**
 * A routine's pins launch on the engine they were validated against:
 * `routine-create` / `routine-update` → daemon store → run task → engine argv.
 */

import { describe, expect, it } from "vitest"
import type { Automation, DaemonTask } from "../../../rove-daemon/src/daemon/contracts.ts"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import type { ApiRuntime } from "../../src/cli/api/types.ts"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import { engineLaunchArgv } from "../../src/engine/engine-presets.ts"
import type { VendorId } from "../../src/types/vendor.ts"
import { stubRuntime } from "../cli/api-handler-fixtures.ts"
import { bootDaemonHarness, fakeOrchestrator } from "./harness.ts"

const REPO = process.cwd()

async function routineHarness() {
  const tasks = new Map<string, DaemonTask>()
  const launches: (readonly string[])[] = []
  const h = await bootDaemonHarness({
    orchestrator: fakeOrchestrator({
      createTask: async (input: Partial<DaemonTask>) => {
        const task = {
          title: "audit",
          branch: "routine/audit",
          status: "in_progress",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...input,
          id: `t${tasks.size + 1}`,
          repo: REPO,
          worktreePath: REPO,
        } as DaemonTask
        tasks.set(task.id, task)
        return task
      },
      getTask: (id: string) => tasks.get(id),
    }),
    server: {
      runtime: {
        ...daemonRuntime,
        startTaskSessionWithPrompt: async (_link: unknown, taskId: string) => {
          const task = tasks.get(taskId)
          if (!task) throw new Error(`missing task ${taskId}`)
          launches.push(engineLaunchArgv({ vendor: task.vendor, model: task.model, effort: task.modelEffort }))
          return { started: true }
        },
      },
    },
  })
  const client = h.client()
  const cli = (verb: string, argv: string[], repoDefault?: VendorId) =>
    invokeVerb(verb, argv, {
      client,
      runtime: stubRuntime({ defaultVendor: async () => repoDefault } as Partial<ApiRuntime>),
    })
  const routines = async () => (await client.request<{ automations: Automation[] }>("automation.list", {})).automations
  const runNow = async (id: string) => {
    expect(await client.request("automation.runNow", { id })).toEqual({ status: "dispatched" })
    return launches.at(-1)
  }
  return { h, cli, routines, runNow }
}

const create = (...extra: string[]) => [
  "--repo",
  REPO,
  "--name",
  "audit",
  "--prompt",
  "audit",
  "--schedule",
  "0 9 * * *",
  "--disabled",
  ...extra,
]

const CODEX_PINNED = ["codex", "-c", "model_reasoning_effort=high", "--model", "gpt-5.5"]

describe("routine engine pins launch on the engine they were validated against", () => {
  it("stores and launches the repo default when pins are set without --vendor", async () => {
    const { h, cli, routines, runNow } = await routineHarness()
    try {
      await cli("routine-create", create("--model", "gpt-5.5", "--effort", "high"), "codex")
      const [routine] = await routines()
      expect(routine).toMatchObject({ vendor: "codex", model: "gpt-5.5", modelEffort: "high" })
      expect((await runNow(routine!.id))?.slice(0, 5)).toEqual(CODEX_PINNED)
    } finally {
      await h.close()
    }
  })

  it("validates against the built-in default when the repo has none", async () => {
    const { h, cli, routines, runNow } = await routineHarness()
    try {
      // `none` is codex's level, not claude's.
      await expect(cli("routine-create", create("--effort", "none"))).rejects.toMatchObject({ code: "BAD_EFFORT" })
      expect(await routines()).toEqual([])
      await cli("routine-create", create("--model", "sonnet"))
      const [routine] = await routines()
      expect(routine).toMatchObject({ vendor: "claude", model: "sonnet" })
      expect(await runNow(routine!.id)).toEqual(["claude", "--model", "sonnet"])
    } finally {
      await h.close()
    }
  })

  it("re-resolves a cleared vendor under retained pins", async () => {
    const { h, cli, routines, runNow } = await routineHarness()
    try {
      await cli("routine-create", create("--vendor", "codex", "--model", "gpt-5.5", "--effort", "none"))
      const [routine] = await routines()
      const id = routine!.id
      await expect(cli("routine-update", ["--id", id, "--vendor", ""], "claude")).rejects.toMatchObject({
        code: "BAD_EFFORT",
      })
      expect(await routines()).toEqual([routine])
      await cli("routine-update", ["--id", id, "--vendor", ""], "codex")
      expect((await routines())[0]).toMatchObject({ vendor: "codex", model: "gpt-5.5", modelEffort: "none" })
      expect((await runNow(id))?.slice(0, 5)).toEqual([
        "codex",
        "-c",
        "model_reasoning_effort=none",
        "--model",
        "gpt-5.5",
      ])
      await cli("routine-update", ["--id", id, "--vendor", "", "--model", "", "--effort", ""], "codex")
      expect((await routines())[0]).not.toHaveProperty("vendor")
    } finally {
      await h.close()
    }
  })

  it("refuses pins without a vendor at the daemon", async () => {
    const { h, routines } = await routineHarness()
    try {
      const c = h.client()
      await expect(
        c.request("automation.create", { name: "a", repo: REPO, prompt: "p", schedule: "0 9 * * *", effort: "high" }),
      ).rejects.toThrow(/must also store the vendor/)
      expect(await routines()).toEqual([])
    } finally {
      await h.close()
    }
  })
})
