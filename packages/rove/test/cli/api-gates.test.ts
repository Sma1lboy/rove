import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const GATE = { id: "g-1", taskId: "t1", tabId: "tab-2", status: "open" }

describe("gate verbs", () => {
  it("gate-raise sends every repeated --option, in order, split at the first =", async () => {
    const client = new FakeClient({ "gate.raise": () => ({ gate: GATE }) })
    const out = await invokeVerb(
      "gate-raise",
      [
        "--task-id",
        "t1",
        "--tab",
        "tab-2",
        "--question",
        "Ship it?",
        "--option",
        "a=ship now",
        "--option",
        "b=wait = review",
        "--recommend",
        "b",
        "--context",
        "costs a day",
      ],
      { client, runtime: stubRuntime() },
    )
    expect(out).toMatchObject({ ok: true, gate: { id: "g-1" } })
    expect(client.requests).toEqual([
      {
        name: "gate.raise",
        payload: {
          taskId: "t1",
          tabId: "tab-2",
          question: "Ship it?",
          options: [
            { key: "a", label: "ship now" },
            { key: "b", label: "wait = review" },
          ],
          recommended: "b",
          context: "costs a day",
        },
      },
    ])
  })

  it("gate-raise rejects an --option without key=label before calling the daemon", async () => {
    const client = new FakeClient()
    await expectApiError(
      () =>
        invokeVerb("gate-raise", ["--task-id", "t1", "--question", "q", "--option", "nolabel"], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_FLAG",
      /key=label/,
    )
    expect(client.requests).toEqual([])
  })

  it("gate-answer needs an option or text, and forwards both when given", async () => {
    const client = new FakeClient({
      "gate.answer": () => ({ gate: { ...GATE, status: "answered" }, delivered: false }),
    })
    await expectApiError(
      () => invokeVerb("gate-answer", ["--gate", "g-1"], { client, runtime: stubRuntime() }),
      "MISSING_FLAG",
    )
    const out = await invokeVerb("gate-answer", ["--gate", "g-1", "--option", "a", "--text", "go"], {
      client,
      runtime: stubRuntime(),
    })
    expect(out).toMatchObject({ ok: true, delivered: false })
    expect(client.requests).toEqual([
      { name: "gate.answer", payload: { gateId: "g-1", option: "a", text: "go", by: "cli" } },
    ])
  })

  it("gate-answer surfaces the daemon's refusal as a typed error code", async () => {
    const client = new FakeClient({
      "gate.answer": () => {
        throw new Error('BAD_OPTION: "z" is not an option of g-1 (a, b)')
      },
    })
    await expectApiError(
      () => invokeVerb("gate-answer", ["--gate", "g-1", "--option", "z"], { client, runtime: stubRuntime() }),
      "BAD_OPTION",
      /not an option/,
    )
  })

  it("gates defaults to open and filters by task and status", async () => {
    const client = new FakeClient({ "gate.list": () => ({ gates: [GATE] }) })
    await invokeVerb("gates", [], { client, runtime: stubRuntime() })
    await invokeVerb("gates", ["--task-id", "t1", "--status", "all"], { client, runtime: stubRuntime() })
    expect(client.requests.map((r) => r.payload)).toEqual([{ status: "open" }, { taskId: "t1", status: "all" }])
  })

  describe("send carries owed answers", () => {
    const owed = { text: "[ROVE GATE g-1 answered] Ship it?\nAnswer: a", gateIds: ["g-1"] }
    function sendClient(take: () => unknown) {
      return new FakeClient({
        "task.get": () => ({ task: taskFixture({ kind: "task" }) }),
        "task.spawn": () => ({ taskId: "kid", task: taskFixture({ id: "kid", kind: "task" }) }),
        "task.setPrompt": () => ({}),
        "gate.takeUndelivered": take,
        "gate.markDelivered": () => ({}),
        "debug.inspect": () => ({ activity: { tasks: {} } }),
      })
    }

    it("prepends them and marks them delivered only after the paste landed", async () => {
      const client = sendClient(() => owed)
      const { calls, deliver } = recordingDelivery()
      await invokeVerb("send", ["--task-id", "t1", "--tab", "tab-2", "--plain", "--prompt", "tick"], {
        client,
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })
      expect(calls[0]?.prompt).toBe(`${owed.text}\n\ntick`)
      expect(client.requests.find((r) => r.name === "gate.takeUndelivered")?.payload).toEqual({
        taskId: "t1",
        tabId: "tab-2",
      })
      expect(client.requests.find((r) => r.name === "gate.markDelivered")?.payload).toEqual({ gateIds: ["g-1"] })
    })

    it("leaves them owed when the paste did not land", async () => {
      const client = sendClient(() => owed)
      const { deliver } = recordingDelivery({ delivered: false })
      await expectApiError(
        () =>
          invokeVerb("send", ["--task-id", "t1", "--tab", "tab-2", "--plain", "--prompt", "tick"], {
            client,
            runtime: stubRuntime({ deliverPrompt: deliver }),
          }),
        "NOT_DELIVERED",
      )
      expect(client.requestNames).not.toContain("gate.markDelivered")
    })

    it("a new child never takes them, and a plain send is unchanged when none are owed", async () => {
      const client = sendClient(() => ({ text: null, gateIds: [] }))
      const { calls, deliver } = recordingDelivery()
      await invokeVerb("send", ["--task-id", "t1", "--tab", "new", "--plain", "--prompt", "hi"], {
        client,
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })
      await invokeVerb("send", ["--task-id", "t1", "--tab", "tab-2", "--plain", "--prompt", "hi"], {
        client,
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })
      expect(calls.map((c) => c.prompt)).toEqual(["hi", "hi"])
      expect(client.requests.filter((r) => r.name === "gate.takeUndelivered")).toHaveLength(1)
      expect(client.requestNames).not.toContain("gate.markDelivered")
    })

    it("a daemon that predates gates never blocks the send", async () => {
      const client = sendClient(() => {
        throw new Error("unknown daemon request: gate.takeUndelivered")
      })
      const { calls, deliver } = recordingDelivery()
      await invokeVerb("send", ["--task-id", "t1", "--tab", "tab-2", "--plain", "--prompt", "hi"], {
        client,
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })
      expect(calls[0]?.prompt).toBe("hi")
    })
  })
})
