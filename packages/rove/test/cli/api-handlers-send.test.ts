/** Request-traffic tests for the `send` handler — split out of
 *  `./api-handlers.test.ts` (which keeps single-task `add`) when that file
 *  crossed the size cap. The seam is the verb: nothing here touches `add`. */

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ApiError, invokeVerb } from "../../src/cli/api-cmd.ts"
import { resetVerifiedSelfSession, verifiedSelfSession } from "../../src/cli/api/dispatcher.ts"
import { deliverHostedPrompt } from "../../src/cli/api/pty-delivery.ts"
import { FakeClient, expectApiError, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

// Peer provenance AND dispatcher provenance both key off the caller's own
// $ROVE_TASK_ID/$ROVE_TAB_ID — unset them file-wide so exact-payload
// assertions stay deterministic when the runner itself lives inside a rove
// task. Tests that WANT provenance set them in their own beforeEach.
const savedEnv = { taskId: process.env.ROVE_TASK_ID, tabId: process.env.ROVE_TAB_ID }
beforeEach(() => {
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.ROVE_TASK_ID
  // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
  delete process.env.ROVE_TAB_ID
})
afterEach(() => {
  for (const [name, value] of [
    ["ROVE_TASK_ID", savedEnv.taskId],
    ["ROVE_TAB_ID", savedEnv.tabId],
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe("send handler", () => {
  it("uses an explicit target without consulting active task", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture({ id: "abc" }) }) })
    const { calls, deliver } = recordingDelivery()
    const result = await invokeVerb("send", ["--task-id", "abc", "--prompt", "hi"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    expect(client.subscribeCount).toBe(0)
    expect(calls[0].prompt).toBe("hi")
    // send targets an EXISTING task — never flagged as a new-task first
    // prompt, so the branch-rename coda can't reach it.
    expect(calls[0].target.newTask).toBeUndefined()
    expect(result).toMatchObject({ ok: true, taskId: "abc", started: true })
  })

  it("reports a prompt that did not land", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture() }) })
    await expectApiError(
      () =>
        invokeVerb("send", ["--task-id", "t1", "--prompt", "hi"], {
          client,
          runtime: stubRuntime({ deliverPrompt: recordingDelivery({ delivered: false }).deliver }),
        }),
      "NOT_DELIVERED",
    )
  })

  // docs/API.md documents `delivered`, `bytes` and `promptEcho` under `send`.
  // The delivery layer measured all three for every path and `send` dropped
  // them, so a successful send carried no `delivered` key at all while a
  // deferred one reported it as the only outcome field — `add` had been
  // emitting the same three the whole time.
  it("reports the delivery facts it documents", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture({ id: "abc" }) }) })
    const { deliver } = recordingDelivery({ bytes: 42, promptEcho: "confirmed" })
    const result = await invokeVerb("send", ["--task-id", "abc", "--prompt", "hi"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    expect(result).toMatchObject({ delivered: true, bytes: 42, promptEcho: "confirmed" })
  })

  // A send is a paste plus Enter. At a permission menu the paste waited in the engine's input and
  // Enter took the highlighted "Yes": answering "4" (No) from the web composer ran the command.
  it("refuses a tab showing a menu, and sends once a client has answered it", async () => {
    const tabs = (kind: string) => ({ "tab-1": { kind, since: 1, alive: true, restored: false, tracked: true } })
    const at = (kind: string) =>
      new FakeClient({
        "task.get": () => ({ task: taskFixture({ id: "abc" }) }),
        "status.list": () => ({ tasks: { abc: { task: { kind, since: 1 }, tabs: tabs(kind) } }, rev: 1 }),
      })
    const refused = recordingDelivery()
    await expectApiError(
      () =>
        invokeVerb("send", ["--task-id", "abc", "--plain", "--prompt", "4"], {
          client: at("needs-input"),
          runtime: stubRuntime({ deliverPrompt: refused.deliver }),
        }),
      "AWAITING_PERMISSION",
    )
    expect(refused.calls).toHaveLength(0)

    const other = recordingDelivery()
    await invokeVerb("send", ["--task-id", "abc", "--tab", "tab-2", "--plain", "--prompt", "hi"], {
      client: at("needs-input"),
      runtime: stubRuntime({ deliverPrompt: other.deliver }),
    })
    expect(other.calls).toHaveLength(1)

    const answered = recordingDelivery()
    await invokeVerb("send", ["--task-id", "abc", "--plain", "--prompt", "hi"], {
      client: at("idle"),
      runtime: stubRuntime({ deliverPrompt: answered.deliver }),
    })
    expect(answered.calls).toHaveLength(1)
  })

  it("requires an explicit or active target", async () => {
    await expectApiError(
      () => invokeVerb("send", ["--prompt", "hi"], { client: new FakeClient(), runtime: stubRuntime() }),
      "MISSING_TARGET",
    )
  })

  // The shell, not Rove, was eating prompts: backticks inside a double-quoted
  // --prompt are command substitution, so the text that names a reply
  // command (`rove api send …`) shipped as that command's OUTPUT. A file (or
  // stdin) bypasses every quoting rule — the bytes on disk are the message.
  it("--prompt-file delivers the file's bytes verbatim, backticks and all", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-prompt-"))
    const file = join(dir, "msg.md")
    const body = "reply via `rove api send --task-id t1 --tab tab-2` and $(echo no)\n"
    writeFileSync(file, body)
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture({ id: "abc" }) }) })
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("send", ["--task-id", "abc", "--prompt-file", file], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })
    expect(calls[0].prompt).toBe(body)
  })

  it("an empty --prompt-file is refused (a blank turn is never what was meant)", async () => {
    await expectApiError(
      () =>
        invokeVerb("send", ["--task-id", "abc", "--prompt-file", "/dev/null"], {
          client: new FakeClient(),
          runtime: stubRuntime(),
        }),
      "BAD_FLAG",
    )
  })

  it("--tab new starts a shared child instead of a second tab, running the pinned engine", async () => {
    const child = taskFixture({
      id: "kid",
      vendor: "codex",
      command: "codex",
      parentTaskId: "abc",
      sharesWorkspaceOf: "abc",
    })
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc", vendor: "claude" }) }),
      "tabs.get": () => ({
        state: { tabs: [{ kind: "engine", id: "tab-1", spawned: true }], activeId: "tab-1" },
        rev: 1,
      }),
      "task.spawn": () => ({ taskId: "kid", task: child, parentDirty: false, sharedLinks: [] }),
      "task.setPrompt": () => ({}),
    })
    const { calls, deliver } = recordingDelivery()
    const result = await invokeVerb(
      "send",
      ["--task-id", "abc", "--prompt", "hi", "--tab", "new", "--command", "codex"],
      {
        client,
        runtime: stubRuntime({ deliverPrompt: deliver }),
      },
    )
    expect(client.requests.find((r) => r.name === "task.spawn")?.payload).toEqual({
      parentTaskId: "abc",
      worktree: false,
      title: "hi",
      command: "codex",
      vendor: "codex",
    })
    // The prompt goes to the child's canonical engine; the parent's conversation is untouched.
    expect(calls).toHaveLength(1)
    expect(calls[0].target).toMatchObject({ id: "kid", command: "codex" })
    expect(calls[0].target.tab).toBeUndefined()
    expect(result).toMatchObject({
      ok: true,
      taskId: "abc",
      childTaskId: "kid",
      session: "kid::tab-1",
      delivered: true,
    })
    expect(client.requests.some((r) => r.name === "task.setCommand")).toBe(false)
  })

  it("--tab new on a task with no conversation delivers to the task itself and names it from the prompt", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "abc", title: "(new task)" }) }),
      "tabs.get": () => ({ state: null, rev: 0 }),
      "task.rename": () => ({}),
      "task.setPrompt": () => ({}),
    })
    const { calls, deliver } = recordingDelivery()
    const result = await invokeVerb(
      "send",
      ["--task-id", "abc", "--prompt", "Fix the login redirect", "--tab", "new"],
      {
        client,
        runtime: stubRuntime({ deliverPrompt: deliver }),
      },
    )
    expect(client.requestNames).not.toContain("task.spawn")
    expect(client.requests.find((r) => r.name === "task.rename")?.payload).toEqual({
      taskId: "abc",
      title: "Fix the login redirect",
    })
    expect(calls[0].target).toMatchObject({ id: "abc", firstConversation: true })
    expect(calls[0].target.tab).toBeUndefined()
    expect(result).toMatchObject({ ok: true, taskId: "abc", delivered: true })
    expect(result).not.toHaveProperty("childTaskId")
  })

  // The lock keys on the task, however the send found it: --task-id, or the active task.
  it.each([
    { how: "--task-id", flags: ["--task-id", "abc"], active: false },
    { how: "the active task", flags: [], active: true },
  ])(
    "two concurrent --tab new on an unstarted task ($how): the first takes tab-1, the second becomes a child and keeps its prompt",
    async ({ flags, active }) => {
      let started = false
      const child = taskFixture({ id: "kid", parentTaskId: "abc", sharesWorkspaceOf: "abc" })
      const client = new FakeClient({
        "task.get": () => ({ task: taskFixture({ id: "abc", title: "(new task)" }) }),
        "tabs.get": () => ({
          state: { tabs: [{ kind: "engine", id: "tab-1", spawned: started }], activeId: "tab-1" },
          rev: 1,
        }),
        "task.list": () => ({ tasks: [] }),
        "task.rename": () => ({}),
        "task.setPrompt": () => ({}),
        "task.spawn": () => ({ taskId: "kid", task: child, parentDirty: false, sharedLinks: [] }),
      })
      if (active) client.replay.push({ channel: "active-task", payload: { taskId: "abc" } })
      const { calls, deliver } = recordingDelivery()
      const slowDeliver: typeof deliver = async (c, target, prompt) => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        const out = await deliver(c, target, prompt)
        started = true
        return out
      }
      const run = (prompt: string) =>
        invokeVerb("send", [...flags, "--prompt", prompt, "--tab", "new", "--plain"], {
          client,
          runtime: stubRuntime({ deliverPrompt: slowDeliver }),
        })
      const results = await Promise.all([run("first"), run("second")])
      expect(calls.map((c) => c.prompt).sort()).toEqual(["first", "second"])
      expect(calls.map((c) => c.target.id).sort()).toEqual(["abc", "kid"])
      expect(results.filter((r) => (r as { childTaskId?: string }).childTaskId)).toHaveLength(1)
    },
  )

  it("refuses --command without --tab new instead of silently running the task's engine", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture({ id: "abc" }) }) })
    await expectApiError(
      () =>
        invokeVerb("send", ["--task-id", "abc", "--prompt", "hi", "--tab", "tab-3", "--command", "codex"], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_FLAG",
    )
  })

  it("rejects a malformed --tab before any delivery", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture({ id: "abc" }) }) })
    await expectApiError(
      () =>
        invokeVerb("send", ["--task-id", "abc", "--prompt", "hi", "--tab", "3"], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_TAB",
    )
  })

  describe("peer provenance ($ROVE_TASK_ID)", () => {
    const saved = process.env.ROVE_TASK_ID
    beforeEach(async () => {
      process.env.ROVE_TASK_ID = "sender-1"
      // Identity is the VERIFIED env pair — prime the memo with a
      // process tree where this process really does descend from the tab's
      // shell, so no real pty-host/ps read happens here.
      await verifiedSelfSession(
        { ROVE_TASK_ID: "sender-1", ROVE_TAB_ID: "tab-1" },
        {
          pid: 500,
          sessions: async () => [{ key: "sender-1::tab-1", pid: 100, alive: true }],
          ps: async () => "  100     1 /bin/zsh -il\n  500   100 bun rove api send",
        },
      )
    })
    afterEach(() => {
      resetVerifiedSelfSession()
      if (saved === undefined) {
        // biome-ignore lint/performance/noDelete: env must fully unset (assigning undefined leaves the string "undefined").
        delete process.env.ROVE_TASK_ID
      } else process.env.ROVE_TASK_ID = saved
    })

    const peerClient = () =>
      new FakeClient({
        "task.get": (payload) => {
          const id = (payload as { taskId: string }).taskId
          return { task: taskFixture({ id, title: id === "sender-1" ? "Auth attempt" : "T" }) }
        },
      })

    it("prefixes cross-task sends with sender identity and a reply command", async () => {
      const { calls, deliver } = recordingDelivery()
      await invokeVerb("send", ["--task-id", "abc", "--prompt", "hi"], {
        client: peerClient(),
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })
      expect(calls[0].prompt).toContain('[ROVE PEER] from "Auth attempt" (task sender-1')
      // Both skill ids, so a receiver on either install finds it.
      expect(calls[0].prompt).toContain("/rove")
      expect(calls[0].prompt).toContain("send --task-id sender-1")
      // The self-teach pointer: a receiver that has never seen rove learns
      // where the rest of the coordination verbs live.
      expect(calls[0].prompt).toContain("Rove agent skill")
      // …and reads it ONCE PER SESSION. "FIRST" had receivers re-loading it
      // per message.
      expect(calls[0].prompt).toContain("once per session")
      // The prefix names where a reply GOES; it does not order one. The old
      // "then reply:" was read as "answer every message", and peers spent a
      // full engine turn each on receipts, started-work notices and
      // acknowledgements of acknowledgements.
      expect(calls[0].prompt).toContain("reply only if it changes what I do next")
      expect(calls[0].prompt).not.toContain("then reply")
      // The sender's text is LAST and whole, after a blank line — not the
      // object of the provenance sentence. A model generates in the language
      // of the tokens nearest its turn, so a non-English prompt wrapped in an
      // English clause came back in English.
      expect(calls[0].prompt).toMatch(/\)\n\nhi$/)
    })

    it("gives a dispatched task the same reply address in its opening brief", async () => {
      // `add --prompt` from inside a rove session is agent-to-agent too, and
      // its brief is where the reply address matters most: every report that
      // task ever sends flows back through it. Recording the sender only as
      // `dispatcher` on the task ROW — data a receiver has to think to go
      // read — leaves a dispatched worker finished and sitting waiting.
      const { calls, deliver } = recordingDelivery()
      await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "研究一下 X"], {
        client: new FakeClient({
          "task.create": () => ({ taskId: "child-1", task: taskFixture({ id: "child-1" }) }),
          "task.get": (payload) => {
            const id = (payload as { taskId: string }).taskId
            return { task: taskFixture({ id, title: id === "sender-1" ? "Auth attempt" : "T" }) }
          },
        }),
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })
      expect(calls[0].prompt).toContain('[ROVE PEER] from "Auth attempt" (task sender-1')
      expect(calls[0].prompt).toContain("send --task-id sender-1 --tab tab-1")
      // Same shape as `send`: the brief is last and whole.
      expect(calls[0].prompt.endsWith("研究一下 X")).toBe(true)
    })

    it("--plain sends verbatim", async () => {
      const { calls, deliver } = recordingDelivery()
      await invokeVerb("send", ["--task-id", "abc", "--prompt", "hi", "--plain"], {
        client: peerClient(),
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })
      expect(calls[0].prompt).toBe("hi")
    })

    it("replaying a refused send's nextCommandArgs delivers the peer header once", async () => {
      const rpc = {
        request: async <T>(name: string): Promise<T> =>
          (name === "pty.list"
            ? {
                sessions: [{ key: "other::tab-1", alive: true, pid: 123, command: ["claude"], title: "" }],
                admissionToken: "t",
              }
            : {}) as T,
      }
      let firstPrompt = ""
      const err = await invokeVerb("send", ["--task-id", "abc", "--prompt", "hi"], {
        client: peerClient(),
        runtime: stubRuntime({
          deliverPrompt: async (_client, target, prompt) => {
            firstPrompt = prompt
            return deliverHostedPrompt(
              rpc,
              { id: target.id },
              "/wt/abc",
              prompt,
              { key: "abc::tab-1", command: ["claude"] },
              {
                maxLiveEngines: 1,
                snapshot: async () => "123 1 claude\n",
              },
            )
          },
        }),
      }).then(
        () => null,
        (e) => e as ApiError,
      )
      expect(err?.code).toBe("ENGINE_LIMIT")
      const retry = err?.data?.nextCommandArgs as string[]
      expect(retry.slice(0, 2)).toEqual(["api", "send"])
      const { calls, deliver } = recordingDelivery()
      await invokeVerb("send", retry.slice(2), {
        client: peerClient(),
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })
      expect(calls[0].prompt).toBe(firstPrompt)
      expect(calls[0].prompt.match(/\[ROVE PEER\]/g)).toHaveLength(1)
    })

    it("a send to yourself stays untouched", async () => {
      const { calls, deliver } = recordingDelivery()
      await invokeVerb("send", ["--task-id", "sender-1", "--prompt", "hi"], {
        client: peerClient(),
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })
      expect(calls[0].prompt).toBe("hi")
    })

    it("a stale sender id degrades to id-only provenance, never a failed send", async () => {
      const client = new FakeClient({
        "task.get": (payload) => {
          const id = (payload as { taskId: string }).taskId
          if (id === "sender-1") throw new ApiError("task not found", "RPC_ERROR")
          return { task: taskFixture({ id }) }
        },
      })
      const { calls, deliver } = recordingDelivery()
      await invokeVerb("send", ["--task-id", "abc", "--prompt", "hi"], {
        client,
        runtime: stubRuntime({ deliverPrompt: deliver }),
      })
      expect(calls[0].prompt).toContain('from "sender-1" (task sender-1')
    })
  })
})
