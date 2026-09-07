/**
 * Request-traffic tests for a PARALLEL `add` round (`--count` / `--agents`).
 *
 * Split out of `api-handlers.test.ts` for the file-size cap. Pins the
 * parallel contract — shared groupId, `#i/N` titles, per-sibling failure rows
 * that never orphan a created task — plus the flag conflicts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ApiError, type ApiRuntime, invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

// Dispatcher provenance keys off the caller's own $KOBE_TASK_ID/$KOBE_TAB_ID —
// unset them file-wide so exact-payload assertions stay deterministic when the
// runner itself lives inside a kobe task (`api-dispatcher.test.ts` owns the
// case where they ARE set).
const savedEnv = { taskId: process.env.KOBE_TASK_ID, tabId: process.env.KOBE_TAB_ID }
beforeEach(() => {
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.KOBE_TASK_ID
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.KOBE_TAB_ID
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

describe("add --count (parallel round)", () => {
  it("refuses --count without a prompt (a parallel round IS its prompt)", async () => {
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    await expectApiError(
      () => invokeVerb("add", ["--repo", "/repo/x", "--count", "3"], { client, runtime: stubRuntime() }),
      "MISSING_FLAG",
    )
    expect(client.requests).toEqual([])
  })

  it.each([
    ["--count", ["--count", "2"]],
    ["--command", ["--command", "codex"]],
  ])("refuses %s alongside --agents instead of silently ignoring it", async (_label, extra) => {
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    await expectApiError(
      () =>
        invokeVerb("add", ["--repo", "/repo/x", "--prompt", "go", "--agents", "claude:2", ...extra], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_FLAG",
    )
    // A fleet is expensive to spawn wrong — nothing may be created.
    expect(client.requests).toEqual([])
  })

  it("refuses --branch on a parallel round (siblings cannot share one branch)", async () => {
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    await expectApiError(
      () =>
        invokeVerb("add", ["--repo", "/repo/x", "--prompt", "go", "--count", "2", "--branch", "feat/x"], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_FLAG",
    )
    expect(client.requests).toEqual([])
  })

  const fanClient = () =>
    new FakeClient({
      "task.create": (_payload, index) => ({ taskId: `t${index + 1}`, task: taskFixture({ id: `t${index + 1}` }) }),
    })

  it("creates and delivers the requested count", async () => {
    const client = fanClient()
    const { calls, deliver } = recordingDelivery()
    const result = (await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "go", "--count", "3"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })) as { count: number; tasks: Array<{ taskId: string }> }
    expect(result.count).toBe(3)
    expect(result.tasks.map((task) => task.taskId)).toEqual(["t1", "t2", "t3"])
    expect(calls.map((call) => call.prompt)).toEqual(["go", "go", "go"])
    // Every sibling is a fresh worktree task → first-prompt coda applies.
    expect(calls.every((call) => call.target.newTask === true)).toBe(true)
  })

  it("applies --status and --pin to every sibling, not just a single add", async () => {
    const client = new FakeClient({
      "task.create": (_payload, index) => ({ taskId: `t${index + 1}`, task: taskFixture({ id: `t${index + 1}` }) }),
      "task.status": () => ({}),
      "task.pin": () => ({}),
    })
    const { deliver } = recordingDelivery()
    await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "go", "--count", "2", "--status", "in_review", "--pin"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    const followUps = client.requests.filter((r) => r.name === "task.status" || r.name === "task.pin")
    expect(followUps).toEqual([
      { name: "task.status", payload: { taskId: "t1", status: "in_review" } },
      { name: "task.pin", payload: { taskId: "t1", pinned: true } },
      { name: "task.status", payload: { taskId: "t2", status: "in_review" } },
      { name: "task.pin", payload: { taskId: "t2", pinned: true } },
    ])
  })

  it("expands per-vendor agent counts in order", async () => {
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "go", "--agents", "claude:2,codex:1"], {
      client: fanClient(),
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    expect(calls.map((call) => call.target.vendor)).toEqual(["claude", "claude", "codex"])
  })

  it("rejects a plan above the cap before creation", async () => {
    const client = fanClient()
    await expectApiError(
      () =>
        invokeVerb("add", ["--repo", "/repo/x", "--prompt", "go", "--count", "11"], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_FLAG",
    )
    expect(client.requests).toEqual([])
  })

  it("stamps a shared groupId and #i/N titles on every sibling", async () => {
    const client = fanClient()
    const { deliver } = recordingDelivery()
    const result = (await invokeVerb(
      "add",
      ["--repo", "/repo/x", "--prompt", "go", "--count", "2", "--title", "auth attempt"],
      { client, runtime: stubRuntime({ deliverPrompt: deliver }) },
    )) as { groupId: string }
    const creates = client.requests.filter((r) => r.name === "task.create").map((r) => r.payload) as Array<
      Record<string, string>
    >
    expect(creates).toHaveLength(2)
    expect(creates[0].groupId).toBe(creates[1].groupId)
    expect(creates[0].groupId).toBe(result.groupId)
    expect(creates.map((p) => p.title)).toEqual(["auth attempt #1/2", "auth attempt #2/2"])
  })

  it("leaves a single-task title un-suffixed and titleless siblings placeholder", async () => {
    const client = fanClient()
    const { deliver } = recordingDelivery()
    await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "go", "--count", "1", "--title", "solo"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "go", "--count", "2"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    const creates = client.requests.filter((r) => r.name === "task.create").map((r) => r.payload) as Array<
      Record<string, string | undefined>
    >
    expect(creates[0].title).toBe("solo")
    // No --title → seeded from the prompt at creation, and the existing #i/N
    // suffix applies to it. Without this a fan-out lands N rows all reading
    // `(new task)`, and QUICKSTART's very next step tells the reader to
    // compare them.
    expect(creates[1].title).toBe("go #1/2")
    expect(creates[2].title).toBe("go #2/2")
  })

  it("names titleless siblings from the prompt so a fan-out is comparable on return", async () => {
    const client = fanClient()
    const { deliver } = recordingDelivery()
    await invokeVerb(
      "add",
      ["--repo", "/repo/x", "--prompt", "Try independent approaches to simplify the auth flow.", "--count", "2"],
      { client, runtime: stubRuntime({ deliverPrompt: deliver }) },
    )
    const titles = client.requests
      .filter((r) => r.name === "task.create")
      .map((r) => (r.payload as Record<string, string | undefined>).title)
    expect(titles).toEqual([
      "Try independent approaches to simplify t… #1/2",
      "Try independent approaches to simplify t… #2/2",
    ])
    // The defect this replaces: N rows all reading `(new task)`, indistinguishable.
    expect(new Set(titles).size).toBe(titles.length)
    expect(titles).not.toContain(undefined)
  })

  it("carries already-created taskIds when a mid-loop create fails (no orphans)", async () => {
    const client = new FakeClient({
      "task.create": (_payload, index) => {
        if (index === 2) throw new ApiError("store exploded", "RPC_ERROR")
        return { taskId: `t${index + 1}`, task: taskFixture({ id: `t${index + 1}` }) }
      },
    })
    const { calls, deliver } = recordingDelivery()
    try {
      await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "go", "--count", "3"], {
        client,
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })
      expect.unreachable("should throw")
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).code).toBe("PARTIAL_FANOUT")
      const data = (error as ApiError).data as {
        count: number
        requested: number
        tasks: Array<{ taskId: string }>
        failures: Array<{ taskId?: string; error: { code: string } }>
      }
      // The two tasks created before the failure are real and delivered —
      // their ids MUST reach the caller so a retry doesn't double-spawn.
      expect(data.count).toBe(2)
      expect(data.requested).toBe(3)
      expect(data.tasks.map((t) => t.taskId)).toEqual(["t1", "t2"])
      expect(data.failures).toEqual([
        { ok: false, vendor: "claude", error: { message: "store exploded", code: "RPC_ERROR" } },
      ])
      expect(calls).toHaveLength(2)
    }
  })

  it("reports every id on partial delivery failure", async () => {
    const deliver: ApiRuntime["deliverPrompt"] = async (_client, target) => {
      if (target.id === "t2") throw new ApiError("boom", "SESSION_FAILED")
      return {
        session: `${target.id}::tab-1`,
        pane: `${target.id}::tab-1`,
        started: true,
        engineReady: true,
        delivered: true,
      }
    }
    try {
      await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "go", "--count", "3"], {
        client: fanClient(),
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })
      expect.unreachable("should throw")
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).code).toBe("PARTIAL_FANOUT")
      expect((error as ApiError).data).toMatchObject({
        count: 3,
        tasks: [{ taskId: "t1" }, { taskId: "t3" }],
        failures: [{ taskId: "t2", error: { code: "SESSION_FAILED" } }],
      })
    }
  })

  it("counts a deferred sibling as a success, not a delivery failure", async () => {
    // A sibling whose composer is briefly busy resolves accepted-but-deferred
    // — `delivered:false` but `deferred` present. The daemon
    // owns the message and queued an inbox episode — the caller must NOT retry.
    // It must land in `tasks` (with the marker), never in `failures`, so the
    // round does not throw PARTIAL_FANOUT and a script does not double-deliver.
    const deliver: ApiRuntime["deliverPrompt"] = async (_client, target) => ({
      session: `${target.id}::tab-1`,
      pane: `${target.id}::tab-1`,
      started: true,
      engineReady: true,
      delivered: target.id !== "t2",
      ...(target.id === "t2" ? { deferred: { id: "d1", layer: "composer-not-empty" as const } } : {}),
    })
    const result = (await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "go", "--count", "3"], {
      client: fanClient(),
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })) as {
      count: number
      tasks: Array<{ taskId: string; deferred?: { id: string; layer: string } }>
      failures: unknown[]
    }
    expect(result.count).toBe(3)
    expect(result.failures).toEqual([])
    expect(result.tasks.map((t) => t.taskId)).toEqual(["t1", "t2", "t3"])
    const deferredRow = result.tasks.find((t) => t.taskId === "t2")
    expect(deferredRow?.deferred).toEqual({ id: "d1", layer: "composer-not-empty" })
  })
})
