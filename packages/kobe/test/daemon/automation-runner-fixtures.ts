/**
 * Shared fixtures for the automation-runner specs.
 *
 * Extracted when the file crossed the size cap, along the seam the specs
 * already had: `automation-runner.test.ts` covers WHEN a schedule fires, and
 * `automation-runner-honesty.test.ts` covers what gets RECORDED about it.
 * Both need the same fake store, orchestrator, runtime and Inbox.
 */

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { vi } from "vitest"
import type { DaemonRpcClient } from "../../../kobe-daemon/src/client/rpc.ts"
import type { DispatchRuntime } from "../../../kobe-daemon/src/daemon/automation-dispatch.ts"
import {
  dueAutomations,
  resolveDueOccurrence,
  runAutomationOnce,
  startAutomationRunner,
  sweepAutomations,
} from "../../../kobe-daemon/src/daemon/automation-runner.ts"
import { AutomationsStore } from "../../../kobe-daemon/src/daemon/automations-store.ts"
import type { Automation, DaemonTask } from "../../../kobe-daemon/src/daemon/contracts.ts"

export const NOW = new Date(2026, 6, 31, 10, 0, 0).getTime() // Fri 2026-07-31 10:00 local
export const HOUR = 3_600_000
/** A real directory: prechecks spawn with `cwd: automation.repo`. */
export const REPO = process.cwd()

export function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    name: "audit",
    repo: REPO,
    prompt: "run the audit",
    schedule: "0 9 * * *",
    enabled: true,
    nextRunAt: new Date(NOW).toISOString(),
    missedRunGraceMinutes: 60,
    createdAt: new Date(NOW - 30 * 24 * HOUR).toISOString(),
    updatedAt: new Date(NOW - 30 * 24 * HOUR).toISOString(),
    ...overrides,
  }
}

export async function tempStore(now = () => NOW): Promise<AutomationsStore> {
  const dir = mkdtempSync(join(tmpdir(), "kobe-automation-runner-"))
  const store = new AutomationsStore(join(dir, "automations.json"), now)
  await store.init()
  return store
}

export const link = {} as DaemonRpcClient

export function fakeDeps(args: {
  store: AutomationsStore
  createTask?: (input: unknown) => Promise<DaemonTask>
  start?: DispatchRuntime["startTaskSessionWithPrompt"]
  /** Tasks `resolveStandingTask` can find, keyed by id. */
  tasks?: Record<string, DaemonTask>
  deliver?: DispatchRuntime["deliverPromptToLiveEngineDetailed"]
}) {
  const created: unknown[] = []
  const prompts: string[] = []
  const delivered: string[] = []
  /** One slot per routine — the store's real dedupe shape, so the test can
   *  tell "refreshed the same episode" from "filed another one". */
  const episodes = new Map<string, { name: string; status: string; error?: string; taskId: string | null }>()
  const inbox = {
    recordPromptDeferred: async () => {},
    recordRoutineFailure: async (
      routine: { automationId: string; name: string; status: string; error?: string },
      taskId: string | null,
    ) => {
      episodes.set(routine.automationId, { ...routine, taskId })
    },
    deleteRoutineEpisode: async (automationId: string) => {
      episodes.delete(automationId)
    },
  }
  return {
    created,
    prompts,
    delivered,
    episodes,
    inbox,
    deps: {
      store: args.store,
      inbox,
      orch: {
        createTask:
          args.createTask ??
          (async (input: unknown) => {
            created.push(input)
            return { id: "task-1" } as DaemonTask
          }),
        getTask: (id: string) => args.tasks?.[id],
      },
      runtime: {
        startTaskSessionWithPrompt:
          args.start ??
          (async (_l: DaemonRpcClient, _id: string, prompt: string) => {
            prompts.push(prompt)
            return { started: true }
          }),
        deliverPromptToLiveEngineDetailed:
          args.deliver ??
          (async (_task: unknown, prompt: string) => {
            delivered.push(prompt)
            return { outcome: "delivered" as const, tabId: "tab-1" }
          }),
      },
      link,
      now: () => NOW,
    },
  }
}
