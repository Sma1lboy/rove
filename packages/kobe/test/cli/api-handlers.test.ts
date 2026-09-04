/** Request-traffic tests for single-task `add`. The `send` handler lives in
 *  `./api-handlers-send.test.ts`; the parallel `add --count` round lives in
 *  `./api-add-parallel.test.ts`. */

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ApiError, type ApiRuntime, invokeVerb } from "../../src/cli/api-cmd.ts"
import { resetVerifiedSelfSession, verifiedSelfSession } from "../../src/cli/api/dispatcher.ts"
import { FakeClient, expectApiError, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

// Peer provenance AND dispatcher provenance both key off the caller's own
// $KOBE_TASK_ID/$KOBE_TAB_ID — unset them file-wide so exact-payload
// assertions stay deterministic when the runner itself lives inside a kobe
// task. Tests that WANT provenance set them in their own beforeEach.
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

describe("add handler", () => {
  it("creates without stealing focus", async () => {
    const task = taskFixture()
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task }) })
    const result = await invokeVerb("add", ["--repo", "/repo/x"], { client, runtime: stubRuntime() })
    expect(client.requestNames).toEqual(["task.create"])
    expect(client.requests[0].payload).toEqual({ repo: "/repo/x" })
    expect(result).toEqual({ taskId: "t1", task, started: false })
  })

  it("sets active only when requested", async () => {
    const client = new FakeClient({
      "task.create": () => ({ taskId: "t1", task: taskFixture() }),
      "task.setActive": () => ({}),
    })
    await invokeVerb("add", ["--repo", "/repo/x", "--activate"], { client, runtime: stubRuntime() })
    expect(client.requestNames).toEqual(["task.create", "task.setActive"])
    expect(client.requests[1].payload).toEqual({ taskId: "t1" })
  })

  it("canonicalizes repo and uses the configured default engine", async () => {
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    await invokeVerb("add", ["--repo", "/repo/x/worktree"], {
      client,
      runtime: stubRuntime({ resolveRepoRoot: async () => "/repo/x", defaultVendor: async () => "codex" }),
    })
    // The default engine is a preset id, so it lands in BOTH fields: the raw
    // command to launch and the protocol it speaks.
    expect(client.requests[0].payload).toEqual({ repo: "/repo/x", command: "codex", vendor: "codex" })
  })

  it("applies status and pin then returns the refreshed task", async () => {
    const fresh = taskFixture({ status: "in_progress", pinned: true })
    const client = new FakeClient({
      "task.create": () => ({ taskId: "t1", task: taskFixture() }),
      "task.status": () => ({}),
      "task.pin": () => ({}),
      "task.get": () => ({ task: fresh }),
    })
    const result = (await invokeVerb(
      "add",
      ["--repo", "/repo/x", "--status", "in_progress", "--pin", "--title", "My task"],
      { client, runtime: stubRuntime() },
    )) as { task: unknown }
    expect(client.requestNames).toEqual(["task.create", "task.status", "task.pin", "task.get"])
    expect(result.task).toEqual(fresh)
  })

  it("passes branch, base branch, and command to creation", async () => {
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    await invokeVerb(
      "add",
      ["--repo", "/repo/x", "--branch", "feat/x", "--base-branch", "main", "--command", "codex"],
      {
        client,
        runtime: stubRuntime(),
      },
    )
    expect(client.requests[0].payload).toEqual({
      repo: "/repo/x",
      branch: "feat/x",
      baseRef: "main",
      command: "codex",
      vendor: "codex",
    })
  })

  it("records a RAW command line verbatim with its resolved protocol", async () => {
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    await invokeVerb("add", ["--repo", "/repo/x", "--command", "codex --search"], {
      client,
      runtime: stubRuntime(),
    })
    // The command is whatever the caller typed; the protocol is derived from
    // its argv[0], never declared alongside it.
    expect(client.requests[0].payload).toEqual({ repo: "/repo/x", command: "codex --search", vendor: "codex" })
  })

  it("records the generic protocol for a command naming no known engine", async () => {
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    await invokeVerb("add", ["--repo", "/repo/x", "--command", "my-wrapper --go"], {
      client,
      runtime: stubRuntime(),
    })
    expect(client.requests[0].payload).toEqual({ repo: "/repo/x", command: "my-wrapper --go", vendor: "generic" })
  })

  it("delivers an explicit prompt to the created task and persists the brief on the record", async () => {
    const task = taskFixture({ kind: "task", vendor: "codex", modelEffort: "high" })
    const client = new FakeClient({
      "task.create": () => ({ taskId: "t1", task }),
      "task.get": () => ({ task }),
      "task.setPrompt": () => ({}),
    })
    const { calls, deliver } = recordingDelivery()
    const result = (await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "do it"], {
      client,
      runtime: stubRuntime({ deliverPrompt: deliver }),
    })) as Record<string, unknown>
    // newTask marks this as a fresh worktree task's FIRST prompt — the
    // delivery layer appends the branch-rename coda for it.
    expect(calls[0]).toMatchObject({
      target: { id: "t1", vendor: "codex", modelEffort: "high", newTask: true },
      prompt: "do it",
    })
    expect(result).toMatchObject({ started: true, engineReady: true, delivered: true, session: "t1::tab-1" })
    // The brief is written to the task record AFTER delivery confirms — the
    // engine transcript is not durable, and this field is the copy that
    // survives a dead engine. Never recorded when the paste never landed.
    expect(client.requests).toContainEqual({ name: "task.setPrompt", payload: { taskId: "t1", prompt: "do it" } })
  })

  /**
   * The persist is best-effort on purpose — the engine already HAS the prompt,
   * so a store fault must not fail a delivered task. What it must not do is
   * report unqualified success: without `.task.prompt` the sidebar menu drops
   * **Run again** (`tree-menu.ts` gates the verb on it), so the action is gone
   * with nothing anywhere saying why. This is the one trigger with no
   * filesystem shape — an RPC/store fault — so it is stubbed rather than
   * injected.
   */
  it("says so when the brief was delivered but never persisted", async () => {
    const task = taskFixture({ kind: "task", vendor: "claude" })
    const client = new FakeClient({
      "task.create": () => ({ taskId: "t1", task }),
      "task.get": () => ({ task }),
      "task.setPrompt": () => {
        throw new Error("issues store is read-only")
      },
    })
    const result = (await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "do it"], {
      client,
      runtime: stubRuntime({ deliverPrompt: recordingDelivery().deliver }),
    })) as Record<string, unknown>
    // Still a success: the task exists and the engine is burning tokens on it.
    expect(result).toMatchObject({ taskId: "t1", delivered: true, promptPersisted: false })
  })

  it("omits promptPersisted when the brief did persist", async () => {
    const task = taskFixture({ kind: "task", vendor: "claude" })
    const client = new FakeClient({
      "task.create": () => ({ taskId: "t1", task }),
      "task.get": () => ({ task }),
      "task.setPrompt": () => ({}),
    })
    const result = (await invokeVerb("add", ["--repo", "/repo/x", "--prompt", "do it"], {
      client,
      runtime: stubRuntime({ deliverPrompt: recordingDelivery().deliver }),
    })) as Record<string, unknown>
    expect(result).not.toHaveProperty("promptPersisted")
  })

  it("reports a created task whose prompt never landed", async () => {
    const task = taskFixture({ kind: "task", vendor: "kimi" })
    const client = new FakeClient({
      "task.create": () => ({ taskId: "t1", task }),
      "task.get": () => ({ task }),
      "task.setPrompt": () => ({}),
    })
    await expectApiError(
      () =>
        invokeVerb("add", ["--repo", "/repo/x", "--prompt", "do it"], {
          client,
          runtime: stubRuntime({ deliverPrompt: recordingDelivery({ delivered: false }).deliver }),
        }),
      "NOT_DELIVERED",
    )
    // A prompt that never reached the engine is never persisted: `get-task`'s
    // `.task.prompt` must always mean "the engine was given exactly this".
    expect(client.requestNames).not.toContain("task.setPrompt")
  })

  it("keeps the spawn-task alias", async () => {
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    const result = (await invokeVerb("spawn-task", ["--repo", "/repo/x"], {
      client,
      runtime: stubRuntime(),
    })) as { taskId: string }
    expect(result.taskId).toBe("t1")
  })
})
