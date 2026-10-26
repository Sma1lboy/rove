/**
 * A routine with no project: `routine-create --no-repo` → daemon store → a
 * `noProject` directory task in the routine's own dir.
 */

import { existsSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Automation } from "../../../rove-daemon/src/daemon/contracts.ts"
import { routineDir } from "../../../rove-daemon/src/daemon/routine-dir.ts"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import type { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import { stubRuntime } from "../cli/api-handler-fixtures.ts"
import { bootDaemonHarness } from "./harness.ts"

const CREATE = ["--name", "nightly", "--prompt", "hi", "--schedule", "0 9 * * *", "--disabled"]

async function harness() {
  const storeHome = mkdtempSync(join(tmpdir(), "rove-no-project-tasks-"))
  const store = new TaskIndexStore({ homeDir: storeHome })
  await store.load()
  const orch = new Orchestrator({ store, worktrees: {} as unknown as GitWorktreeManager })
  const started: string[] = []
  const h = await bootDaemonHarness({
    orchestrator: orch,
    server: {
      runtime: {
        ...daemonRuntime,
        startTaskSessionWithPrompt: async (_link: unknown, taskId: string) => {
          started.push(taskId)
          return { started: true }
        },
      },
    },
  })
  const client = h.client()
  const cli = (verb: string, argv: string[]) => invokeVerb(verb, argv, { client, runtime: stubRuntime() })
  return { h, orch, cli, client, started }
}

describe("routine-create --no-repo", () => {
  it("creates a projectless routine whose run is a noProject dir task in its own directory", async () => {
    const { h, orch, cli, client, started } = await harness()
    try {
      const { automation } = (await cli("routine-create", ["--no-repo", ...CREATE])) as { automation: Automation }
      expect(automation).not.toHaveProperty("repo")
      // Created at save, before any firing.
      expect(existsSync(routineDir(automation.id))).toBe(true)

      expect(await client.request("automation.runNow", { id: automation.id })).toEqual({ status: "dispatched" })
      const [task] = orch.listTasks()
      expect(task).toMatchObject({ kind: "dir", noProject: true, title: "nightly" })
      expect(task?.scratch).toBeUndefined()
      expect(realpathSync(task?.worktreePath ?? "")).toBe(realpathSync(routineDir(automation.id)))
      expect(started).toEqual([task?.id])
    } finally {
      await h.close()
    }
  })

  it("needs exactly one of --repo and --no-repo, and a projectless routine has no base branch", async () => {
    const { h, cli } = await harness()
    try {
      await expect(cli("routine-create", CREATE)).rejects.toThrow(/exactly one of --repo PATH or --no-repo/)
      await expect(cli("routine-create", ["--no-repo", "--repo", process.cwd(), ...CREATE])).rejects.toThrow(
        /--repo and --no-repo conflict/,
      )
      await expect(cli("routine-create", ["--no-repo", "--base-branch", "main", ...CREATE])).rejects.toThrow(
        /no base branch/,
      )
    } finally {
      await h.close()
    }
  })

  it("update never converts between a repo and no project, and refuses a base branch", async () => {
    const { h, cli } = await harness()
    try {
      const { automation } = (await cli("routine-create", ["--no-repo", ...CREATE])) as { automation: Automation }
      await expect(cli("routine-update", ["--id", automation.id, "--base-branch", "main"])).rejects.toThrow(
        /no base branch/,
      )
      const { automation: renamed } = (await cli("routine-update", ["--id", automation.id, "--name", "x"])) as {
        automation: Automation
      }
      expect(renamed).not.toHaveProperty("repo")
    } finally {
      await h.close()
    }
  })
})
