/**
 * `add --tier` — filling engine/model/effort from the auto-effort table, and
 * `--tier auto`, where a classifier names the row instead of the caller.
 *
 * Two things are mocked, both for the same reason — the answer must not
 * depend on the machine running the suite: the account probe (the gate's
 * login half) and the classifier (which would otherwise be a network call).
 * What the classifier itself does with a response is
 * `test/engine/auto-effort-classifier.test.ts`; what is tested HERE is the
 * wiring — that a pick fills the fields, and that every decline creates the
 * task anyway.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const probe = vi.hoisted(() => ({ kind: "oauth" as string }))
const classifier = vi.hoisted(() => ({
  outcome: { kind: "declined", reason: "off" } as
    | { kind: "picked"; verdict: { tier: string; confidence: number } }
    | { kind: "declined"; reason: string; detail?: string },
  calls: [] as string[],
}))
vi.mock("../../src/engine/auto-effort-classifier.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/engine/auto-effort-classifier.ts")>()
  return {
    ...actual,
    readClassifierConfig: () => ({
      mode: { kind: "jev" as const },
      threshold: 0.5,
      timeoutMs: 1000,
      model: "jev-latest",
      keyEnv: "TYPESAFE_API_KEY",
    }),
    classifyTier: async (text: string) => {
      classifier.calls.push(text)
      return classifier.outcome
    },
  }
})
vi.mock("../../src/engine/engine-status.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/engine/engine-status.ts")>()
  return {
    ...actual,
    detectEngineStatus: async (vendor: string) => ({
      vendor,
      binary: { found: true, path: `/usr/local/bin/${vendor}` },
      account: { kind: probe.kind },
    }),
  }
})

const { invokeVerb } = await import("../../src/cli/api-cmd.ts")
const { FakeClient, expectApiError, recordingDelivery, stubRuntime, taskFixture } = await import(
  "./api-handler-fixtures.ts"
)
const { ApiError } = await import("../../src/cli/api/types.ts")

const savedEnv = { taskId: process.env.KOBE_TASK_ID, tabId: process.env.KOBE_TAB_ID }
beforeEach(() => {
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.KOBE_TASK_ID
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.KOBE_TAB_ID
  probe.kind = "oauth"
  classifier.outcome = { kind: "declined", reason: "off" }
  classifier.calls = []
})
afterEach(() => {
  for (const [name, value] of [
    ["KOBE_TASK_ID", savedEnv.taskId],
    ["KOBE_TAB_ID", savedEnv.tabId],
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

const createClient = () => new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })

describe("add --tier", () => {
  it("fills engine + model from the shipped table and records the tier", async () => {
    const client = createClient()
    await invokeVerb("add", ["--repo", "/repo/x", "--tier", "deep"], { client, runtime: stubRuntime() })
    expect(client.requests[0]?.name).toBe("task.create")
    expect(client.requests[0]?.payload).toMatchObject({
      command: "claude",
      vendor: "claude",
      model: "fable",
      tier: "deep",
    })
    expect(client.requests[0]?.payload).not.toHaveProperty("effort")
  })

  it("refuses an explicit engine field beside a tier — both cannot apply", async () => {
    for (const extra of [
      ["--model", "opus"],
      ["--effort", "high"],
      ["--command", "codex"],
    ]) {
      const client = createClient()
      await expectApiError(
        () => invokeVerb("add", ["--repo", "/repo/x", "--tier", "deep", ...extra], { client, runtime: stubRuntime() }),
        "CONFLICTING_FLAGS",
        /conflicts with --tier/,
      )
      expect(client.requests).toEqual([])
    }
  })

  it("refuses a tier whose engine is not logged in, before creating anything", async () => {
    probe.kind = "none"
    const client = createClient()
    await expectApiError(
      () => invokeVerb("add", ["--repo", "/repo/x", "--tier", "swift"], { client, runtime: stubRuntime() }),
      "TIER_UNAVAILABLE",
      /not logged in/,
    )
    expect(client.requests).toEqual([])
  })
})

describe("add --tier auto", () => {
  // The auto path always carries a prompt, so the create is followed by a
  // delivery, a `task.setPrompt` and a re-`get` — all of which the bare
  // create-only fake has no answer for.
  const promptClient = () =>
    new FakeClient({
      "task.create": () => ({ taskId: "t1", task: taskFixture() }),
      "task.get": () => ({ task: taskFixture() }),
      "task.setPrompt": () => ({}),
    })

  const withPrompt = (extra: string[] = []) => [
    "--repo",
    "/repo/x",
    "--tier",
    "auto",
    "--prompt",
    "there is a memory leak somewhere in the daemon",
    ...extra,
  ]

  it("fills the row the classifier named, and records the tier on the task", async () => {
    classifier.outcome = { kind: "picked", verdict: { tier: "deep", confidence: 0.71 } }
    const client = promptClient()
    const { deliver } = recordingDelivery()
    const result = (await invokeVerb("add", withPrompt(), {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })) as { tierAuto?: string }
    expect(classifier.calls).toEqual(["there is a memory leak somewhere in the daemon"])
    expect(client.requests[0]?.payload).toMatchObject({ command: "claude", model: "fable", tier: "deep" })
    expect(result.tierAuto).toMatch(/auto → deep \(confidence 0\.71\)/)
  })

  it("creates the task anyway when the classifier declines, and says why", async () => {
    for (const outcome of [
      { kind: "declined" as const, reason: "off" },
      { kind: "declined" as const, reason: "no-key", detail: "TYPESAFE_API_KEY is not set" },
      { kind: "declined" as const, reason: "low-confidence", detail: "standard at 0.44" },
      { kind: "declined" as const, reason: "failed", detail: "timed out after 4000ms" },
    ]) {
      classifier.outcome = outcome
      const client = promptClient()
      const { deliver } = recordingDelivery()
      const result = (await invokeVerb("add", withPrompt(), {
        client,
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })) as { tierAuto?: string }
      // The create happened, and it carries no tier — not a wrong one.
      expect(client.requests[0]?.name).toBe("task.create")
      expect(client.requests[0]?.payload).not.toHaveProperty("tier")
      expect(result.tierAuto).toContain(outcome.reason)
    }
  })

  it("carries what it decided into a DELIVERY FAILURE too, not just a success", async () => {
    // The task exists and is already carrying the tier. An error that drops
    // that leaves a caller unable to tell "routed to deep, engine died" from
    // "never routed at all" without a second round-trip.
    classifier.outcome = { kind: "picked", verdict: { tier: "deep", confidence: 0.9 } }
    const client = promptClient()
    const failing = async () => {
      throw new ApiError("failed to start hosted engine session for t1", "SESSION_FAILED", { taskId: "t1" })
    }
    try {
      await invokeVerb("add", withPrompt(), { client, runtime: stubRuntime({ deliverPrompt: failing }) })
      expect.unreachable("should have thrown")
    } catch (error) {
      const err = error as { code: string; data?: Record<string, unknown> }
      expect(err.code).toBe("SESSION_FAILED")
      // The original context survives alongside the addition.
      expect(err.data?.taskId).toBe("t1")
      expect(String(err.data?.tierAuto)).toMatch(/auto → deep/)
    }
  })

  it("carries a DECLINE into a delivery failure as well", async () => {
    classifier.outcome = { kind: "declined", reason: "low-confidence", detail: "standard at 0.44" }
    const client = promptClient()
    const failing = async () => {
      throw new ApiError("nope", "SESSION_FAILED", { taskId: "t1" })
    }
    try {
      await invokeVerb("add", withPrompt(), { client, runtime: stubRuntime({ deliverPrompt: failing }) })
      expect.unreachable("should have thrown")
    } catch (error) {
      const err = error as { data?: Record<string, unknown> }
      expect(String(err.data?.tierAuto)).toContain("low-confidence")
    }
  })

  it("refuses --tier auto with nothing to classify, before anything is created", async () => {
    const client = createClient()
    await expectApiError(
      () => invokeVerb("add", ["--repo", "/repo/x", "--tier", "auto"], { client, runtime: stubRuntime() }),
      "BAD_FLAG",
      /--prompt/,
    )
    expect(client.requests).toEqual([])
    expect(classifier.calls).toEqual([])
  })

  it("still refuses an explicit engine field beside it — auto fills the same three", async () => {
    const client = createClient()
    await expectApiError(
      () => invokeVerb("add", withPrompt(["--model", "opus"]), { client, runtime: stubRuntime() }),
      "CONFLICTING_FLAGS",
    )
    expect(classifier.calls).toEqual([])
  })

  it("creates the task when the classifier picks a tier this machine cannot start", async () => {
    // A tier the CALLER named is a refusal (TIER_UNAVAILABLE, tested above);
    // one the classifier guessed at is our problem, not theirs.
    classifier.outcome = { kind: "picked", verdict: { tier: "deep", confidence: 0.9 } }
    probe.kind = "none"
    const client = promptClient()
    const { deliver } = recordingDelivery()
    const result = (await invokeVerb("add", withPrompt(), {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })) as { tierAuto?: string }
    expect(client.requests[0]?.name).toBe("task.create")
    expect(client.requests[0]?.payload).not.toHaveProperty("tier")
    expect(result.tierAuto).toMatch(/unusable/)
  })
})
