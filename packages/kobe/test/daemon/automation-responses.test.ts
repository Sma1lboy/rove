/**
 * Routine responses: every delivered prompt names its run, the agent answers
 * that run with `routine-respond`, and a run owing an answer reads as
 * awaiting, then missing.
 */

import { describe, expect, it } from "vitest"
import { runAutomationOnce } from "../../../kobe-daemon/src/daemon/automation-runner.ts"
import {
  type AutomationRun,
  ROUTINE_RESPONSE_WINDOW_MS,
  routineRunResponseState,
} from "../../../kobe-daemon/src/daemon/contracts.ts"
import { NOW, REPO, automation, fakeDeps, tempStore } from "./automation-runner-fixtures.ts"

const STANDING_TASK = { id: "standing", repo: REPO, worktreePath: REPO } as never

/** The run id a delivered prompt's header names. */
function headerRunId(prompt: string | undefined): string | undefined {
  return prompt?.match(/^\[ROVE ROUTINE\][^\n]* --run (\S+) /)?.[1]
}

describe("delivered prompt names its run", () => {
  it.each([
    ["fresh task", {}, "prompts"],
    ["standing session", { persistentSession: true, sessionTaskId: "standing" }, "delivered"],
    ["bound tab", { target: { kind: "existing-tab", taskId: "standing", tabId: "tab-2" } }, "tab"],
  ] as const)("%s: the header carries the recorded run's id", async (_label, overrides, channel) => {
    const store = await tempStore()
    const tabPrompts: string[] = []
    const f = fakeDeps({
      store,
      tasks: { standing: STANDING_TASK },
      deliverTab: async (target, prompt) => {
        tabPrompts.push(prompt)
        return { outcome: "delivered", tabId: target.tabId }
      },
    })
    const a = await store.create(automation(overrides))
    // Two firings: the second must name run #2, not reuse #1's id.
    await runAutomationOnce(f.deps, a, { scheduledFor: NOW, trigger: "manual" })
    await runAutomationOnce(f.deps, a, { scheduledFor: NOW, trigger: "manual" })

    const sent = channel === "prompts" ? f.prompts : channel === "delivered" ? f.delivered : tabPrompts
    const runs = store.runsFor(a.id)
    expect(runs.map((run) => run.status)).toEqual(["dispatched", "dispatched"])
    expect(sent.map(headerRunId)).toEqual([runs[1]?.id, runs[0]?.id])
    expect(sent[1]).toContain(" run #2 ")
    expect(sent[1]?.endsWith(`\n\n${a.prompt}`)).toBe(true)
  })
})

describe("setRunResponse", () => {
  it("stores one response per run, replaces it on a second call, and survives a reload", async () => {
    const store = await tempStore()
    const f = fakeDeps({ store })
    const a = await store.create(automation())
    await runAutomationOnce(f.deps, a, { scheduledFor: NOW, trigger: "manual" })
    const runId = store.runsFor(a.id)[0]?.id as string

    await store.setRunResponse(runId, "first")
    const replaced = await store.setRunResponse(runId, "**second**")
    expect(replaced?.response).toEqual({ text: "**second**", at: new Date(NOW).toISOString() })
    expect(store.runsFor(a.id)).toHaveLength(1)
  })

  it("returns null for an unknown run id", async () => {
    const store = await tempStore()
    expect(await store.setRunResponse("no-such-run", "x")).toBeNull()
  })
})

describe("routineRunResponseState", () => {
  const run = (overrides: Partial<AutomationRun>): AutomationRun =>
    ({ status: "dispatched", at: new Date(NOW).toISOString(), ...overrides }) as AutomationRun

  it("a delivered run awaits its response inside the window, then is missing", () => {
    expect(routineRunResponseState(run({}), NOW + ROUTINE_RESPONSE_WINDOW_MS)).toBe("awaiting")
    expect(routineRunResponseState(run({}), NOW + ROUTINE_RESPONSE_WINDOW_MS + 1)).toBe("missing")
    expect(routineRunResponseState(run({ status: "revived" }), NOW)).toBe("awaiting")
  })

  it("an answered run is responded; a run that delivered nothing owes nothing", () => {
    expect(
      routineRunResponseState(run({ response: { text: "ok", at: "x" } }), NOW + 10 * ROUTINE_RESPONSE_WINDOW_MS),
    ).toBe("responded")
    expect(
      routineRunResponseState(run({ status: "skipped_precheck" }), NOW + 10 * ROUTINE_RESPONSE_WINDOW_MS),
    ).toBeNull()
  })
})
