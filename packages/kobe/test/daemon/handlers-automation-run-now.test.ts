/**
 * `automation.runNow` (the Automations page's Run now, and
 * `rove api routine-run-now`) has to reach the SAME dispatch outcome the
 * scheduled sweep would for the same firing.
 *
 * The one that mattered: a standing routine fired into a busy composer.
 * Without the deferred-prompt store and the Inbox on its deps, the dispatch
 * path has nowhere to put the text and gives up with `dispatch_failed` — so a
 * manual run DROPPED the report while the identical scheduled firing filed it
 * in the Inbox. Two indistinguishable-looking outcomes, one of them lossy.
 *
 * Driven through the real RPC handler on a real daemon (temp home, temp
 * socket) because the bug was in the handler's dep object, not in the runner
 * the runner-level tests already cover.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { DaemonTask } from "../../../kobe-daemon/src/daemon/contracts.ts"
import type { Orchestrator } from "../../src/orchestrator/core.ts"
import { type DaemonHarness, bootDaemonHarness, fakeOrchestrator } from "./harness.ts"

const REPO = process.cwd()

function standingTask(): DaemonTask {
  return {
    id: "task-standing",
    title: "daily audit",
    repo: REPO,
    branch: "routine/daily-audit",
    worktreePath: join(REPO, ".worktree-double"),
    kind: "task",
    status: "in_progress",
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as DaemonTask
}

/** An orchestrator that always hands back the same standing task. */
function orchestratorWithStandingTask(): Orchestrator {
  const task = standingTask()
  return fakeOrchestrator({
    listTasks: () => [task],
    getTask: (id: string) => (id === task.id ? task : undefined),
    createTask: async () => task,
  })
}

/** A runtime whose live engine always refuses: the composer has text in it. */
const busyRuntime = {
  startTaskSessionWithPrompt: async () => true,
  deliverPromptToLiveEngineDetailed: async () => ({
    outcome: "busy" as const,
    tabId: "tab-1",
    layer: "composer-not-empty" as const,
  }),
}

function inboxItems(harness: DaemonHarness): unknown[] {
  const path = join(harness.dir, ".rove", "attention-inbox.json")
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { items?: unknown[]; episodes?: unknown[] }
    return parsed.items ?? parsed.episodes ?? []
  } catch {
    return []
  }
}

describe("automation.runNow on a standing routine with a busy composer", () => {
  it("defers the prompt into the Inbox instead of dropping it", async () => {
    const harness = await bootDaemonHarness({
      orchestrator: orchestratorWithStandingTask(),
      server: {
        automationTickMs: 0,
        runtime: { ...(await import("../../src/core/daemon-runtime.ts")).daemonRuntime, ...busyRuntime },
      },
    })
    try {
      const client = harness.client()
      const created = await client.request<{ automation: { id: string } }>("automation.create", {
        repo: REPO,
        name: "daily audit",
        prompt: "what changed since yesterday?",
        schedule: "0 9 * * *",
        persistentSession: true,
      })
      const id = created.automation.id

      // First run adopts the standing task (its engine "starts"); the second
      // one is the firing that meets the busy composer.
      const first = await client.request<{ status: string }>("automation.runNow", { id })
      expect(first.status).toBe("dispatched")
      expect(inboxItems(harness)).toHaveLength(0)

      const second = await client.request<{ status: string }>("automation.runNow", { id })
      expect(second.status).toBe("deferred")
      expect(inboxItems(harness).length).toBeGreaterThan(0)

      // The run history is what the user reads, so it has to say the same.
      const { runs } = await client.request<{ runs: Array<{ status: string }> }>("automation.runs", { id })
      expect(runs.map((r) => r.status)).toContain("deferred")
      expect(runs.map((r) => r.status)).not.toContain("dispatch_failed")
    } finally {
      await harness.close()
    }
  })
})
