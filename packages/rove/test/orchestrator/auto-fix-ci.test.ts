import { AUTO_FIX_MAX, autoFixDecision, coerceAutoFix } from "@sma1lboy/rove-daemon/auto-fix-ci"
import { type AutoFixDeps, needsPrPoll, runAutoFixPass } from "@sma1lboy/rove-daemon/daemon/auto-fix-ci"
import { describe, expect, it } from "vitest"

const red = { lifecycle: "open", checkState: "failing", headSha: "sha-b" }

describe("autoFixDecision", () => {
  it.each([
    ["turn_complete", "fire"],
    ["idle", "fire"],
    ["running", "wait"],
    ["permission_needed", "wait"],
    ["rate_limited", "wait"],
    ["error", "wait"],
    ["dead", "wait"],
    [undefined, "wait"],
  ])("on a red new sha, engine %s → %s (fires only at rest)", (engine, decision) => {
    expect(autoFixDecision({ state: { attempts: 0 }, pr: red, engine })).toEqual({ do: decision })
  })

  it("tries a sha once, and a new push is a new failure", () => {
    expect(autoFixDecision({ state: { attempts: 1, lastSha: "sha-b" }, pr: red, engine: "idle" })).toEqual({
      do: "skip",
    })
    expect(autoFixDecision({ state: { attempts: 1, lastSha: "sha-a" }, pr: red, engine: "idle" })).toEqual({
      do: "fire",
    })
  })

  it("stops at the cap on the next new red sha, once", () => {
    const spent = { attempts: AUTO_FIX_MAX, lastSha: "sha-a" }
    expect(autoFixDecision({ state: spent, pr: red, engine: "running" })).toEqual({ do: "stop" })
    expect(autoFixDecision({ state: { ...spent, stopped: true }, pr: red, engine: "idle" })).toEqual({ do: "skip" })
  })

  it("does nothing when off, with no PR, a closed PR, unknown checks or no head sha; green resets the count", () => {
    const state = { attempts: 2, lastSha: "sha-a" }
    expect(autoFixDecision({ state: undefined, pr: red, engine: "idle" })).toEqual({ do: "skip" })
    expect(autoFixDecision({ state, pr: undefined, engine: "idle" })).toEqual({ do: "skip" })
    expect(autoFixDecision({ state, pr: { ...red, lifecycle: "merged" }, engine: "idle" })).toEqual({ do: "skip" })
    expect(autoFixDecision({ state, pr: { ...red, checkState: "pending" }, engine: "idle" })).toEqual({ do: "skip" })
    expect(autoFixDecision({ state, pr: { ...red, headSha: undefined }, engine: "idle" })).toEqual({ do: "skip" })
    expect(autoFixDecision({ state, pr: { ...red, checkState: "passing" }, engine: "idle" })).toEqual({ do: "reset" })
    expect(autoFixDecision({ state: { attempts: 0 }, pr: { ...red, checkState: "passing" }, engine: "idle" })).toEqual({
      do: "skip",
    })
  })
})

describe("coerceAutoFix", () => {
  it("reads a stored state back, clamping and dropping junk", () => {
    expect(coerceAutoFix({ attempts: 9, lastSha: "x", stopped: true })).toEqual({
      attempts: AUTO_FIX_MAX,
      lastSha: "x",
      stopped: true,
    })
    expect(coerceAutoFix({ attempts: -1, lastSha: "" })).toEqual({ attempts: 0 })
    expect(coerceAutoFix(null)).toBeUndefined()
    expect(coerceAutoFix("on")).toBeUndefined()
  })
})

function world(over: { task?: Record<string, unknown>; engine?: string; delivered?: boolean; checks?: unknown } = {}) {
  const task = {
    id: "t1",
    branch: "feat/x",
    worktreePath: "/wt",
    autoFixCi: { attempts: 0 },
    prStatus: { lifecycle: "open", checkState: "failing", number: 7, headSha: "sha-b" },
    ...over.task,
  }
  const writes: unknown[] = []
  const sent: string[] = []
  const inbox: unknown[] = []
  const deps = {
    orch: {
      listTasks: () => [task],
      setAutoFixCi: async (_id: string, state: unknown) => {
        writes.push(state)
        ;(task as { autoFixCi?: unknown }).autoFixCi = state ?? undefined
      },
    },
    runtime: {
      buildCIPrompt: async (_wt: string, s: { checks: readonly { jobName: string }[] }) =>
        `fix ${s.checks.map((c) => c.jobName)}`,
      deliverPromptToLiveEngineDetailed: async (_t: unknown, prompt: string) => {
        if (over.delivered === false) return { outcome: "no-session" }
        sent.push(prompt)
        return { outcome: "delivered", tabId: "tab-1" }
      },
    },
    activity: { stateOf: () => over.engine ?? "turn_complete" },
    inbox: { record: async (...args: unknown[]) => void inbox.push(args) },
    readChecks: async () => over.checks ?? { checks: [{ jobName: "lint" }], totalFailing: 1 },
  } as unknown as AutoFixDeps
  return { task, deps, writes, sent, inbox }
}

describe("runAutoFixPass", () => {
  it("sends the prompt once per sha and records the attempt", async () => {
    const w = world()
    await runAutoFixPass(w.deps)
    await runAutoFixPass(w.deps)
    expect(w.sent).toEqual(["[auto-fix CI 1/3] fix lint"])
    expect(w.task.autoFixCi).toEqual({ attempts: 1, lastSha: "sha-b" })
  })

  it("holds while the engine is mid-turn and sends once it rests", async () => {
    const w = world({ engine: "running" })
    await runAutoFixPass(w.deps)
    expect(w.sent).toEqual([])
    expect(w.writes).toEqual([])
  })

  it("spends no attempt when no engine takes it or the checks cannot be read", async () => {
    const none = world({ delivered: false })
    await runAutoFixPass(none.deps)
    expect(none.task.autoFixCi).toEqual({ attempts: 0 })
    const down = world({ checks: { checks: [], totalFailing: 0, unavailable: { reason: "gh", detail: "x" } } })
    await runAutoFixPass(down.deps)
    expect(down.writes).toEqual([])
    expect(down.sent).toEqual([])
  })

  it("at the cap marks the loop stopped and tells the Inbox, once", async () => {
    const w = world({ task: { autoFixCi: { attempts: AUTO_FIX_MAX, lastSha: "sha-a" } } })
    await runAutoFixPass(w.deps)
    await runAutoFixPass(w.deps)
    expect(w.sent).toEqual([])
    expect(w.writes).toEqual([{ attempts: AUTO_FIX_MAX, lastSha: "sha-a", stopped: true }])
    expect(w.inbox).toHaveLength(1)
  })

  it("leaves archived and deleting tasks alone", async () => {
    const w = world({ task: { archived: true } })
    await runAutoFixPass(w.deps)
    expect(w.sent).toEqual([])
  })
})

describe("needsPrPoll", () => {
  it("is true only for an opted-in, live task whose PR is open or not yet seen", () => {
    const on = { id: "a", worktreePath: "/w", autoFixCi: { attempts: 0 }, prStatus: { lifecycle: "open" } }
    expect(needsPrPoll([on] as never)).toBe(true)
    expect(needsPrPoll([{ ...on, prStatus: undefined }] as never)).toBe(true)
    expect(needsPrPoll([{ ...on, prStatus: { lifecycle: "merged" } }] as never)).toBe(false)
    expect(needsPrPoll([{ ...on, autoFixCi: undefined }] as never)).toBe(false)
  })
})
