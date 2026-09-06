/** Request-traffic tests for single-task `add`. The `send` handler lives in
 *  `./api-handlers-send.test.ts`; the parallel `add --count` round lives in
 *  `./api-add-parallel.test.ts`. */

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ApiError, type ApiRuntime, invokeVerb } from "../../src/cli/api-cmd.ts"
import { resetVerifiedSelfSession, verifiedSelfSession } from "../../src/cli/api/dispatcher.ts"
import { homeDir } from "../../src/env.ts"
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
    expect(result).toEqual({ taskId: "t1", task, home: homeDir(), started: false })
  })

  it("refuses a --repo that is not a git repository instead of succeeding emptily", async () => {
    // A task IS a worktree + branch, so a non-repo has nothing to cut one
    // from. This used to return `ok: true` with an empty branch and an empty
    // worktreePath, and the row persisted — the failure surfaced much later,
    // when someone opened it and landed on an empty path.
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    await expect(
      invokeVerb("add", ["--repo", "/plain/dir"], {
        client,
        runtime: stubRuntime({ isUsableRepo: async () => false }),
      }),
    ).rejects.toThrow(/not a git repository/)
    // Nothing was created.
    expect(client.requestNames).toEqual([])
  })

  it("refuses a --branch git will not accept, before anything is created", async () => {
    // `--branch` was only type-checked, so `add --branch "a b"` exited 0 with
    // the row in the backlog and the failure deferred to `ensure-worktree`,
    // where it surfaced as a raw `git worktree add` transcript under
    // `RPC_ERROR` — no code, no hint, and a row that can never materialize.
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    for (const bad of ["a b", "-rf", "feat/x..y"]) {
      await expectApiError(
        () =>
          invokeVerb("add", ["--repo", "/repo/x", "--branch", bad], {
            client,
            runtime: stubRuntime({ isValidBranchName: async () => false }),
          }),
        "INVALID_BRANCH",
      )
    }
    expect(client.requestNames).toEqual([])
  })

  it("leaves a parallel round's --branch refusal to the parallel path", async () => {
    // `--count` rejects `--branch` outright (siblings cannot share one
    // branch), and that is the more useful answer than "this name is
    // malformed" — so the name check must not get there first and shadow it.
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    await expectApiError(
      () =>
        invokeVerb("add", ["--repo", "/repo/x", "--count", "3", "--prompt", "p", "--branch", "a b"], {
          client,
          runtime: stubRuntime({ isValidBranchName: async () => false }),
        }),
      "BAD_FLAG",
    )
  })

  it("still accepts a branch name git allows", async () => {
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    await invokeVerb("add", ["--repo", "/repo/x", "--branch", "feat/ok"], { client, runtime: stubRuntime() })
    expect(client.requests[0].payload).toMatchObject({ branch: "feat/ok" })
  })

  it("says so when --repo resolved UP out of a subdirectory", async () => {
    // `--repo my-repo/packages/app` came back as `"repo": "…/my-repo"` with
    // no trace of the levels it climbed, so a typo'd path and an intended one
    // produced identical output.
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    const result = (await invokeVerb("add", ["--repo", "/repo/x/packages/app"], {
      client,
      runtime: stubRuntime({ resolveRepoRoot: async () => "/repo/x" }),
    })) as { repoResolvedFrom?: string }
    expect(result.repoResolvedFrom).toBe("/repo/x/packages/app")
    expect(client.requests[0].payload).toMatchObject({ repo: "/repo/x" })
  })

  it("stays quiet when --repo already named the root, or git only realpath'd it", async () => {
    // The field must not fire on a CORRECT path. `resolveRepoRoot` shells
    // git, which reports the realpath, so `/tmp/x` comes back as
    // `/private/tmp/x` on macOS — a rewrite, not a climb, and not a prefix.
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    const exact = (await invokeVerb("add", ["--repo", "/repo/x"], { client, runtime: stubRuntime() })) as {
      repoResolvedFrom?: string
    }
    expect(exact.repoResolvedFrom).toBeUndefined()
    const symlinked = (await invokeVerb("add", ["--repo", "/tmp/x"], {
      client,
      runtime: stubRuntime({ resolveRepoRoot: async () => "/private/tmp/x" }),
    })) as { repoResolvedFrom?: string }
    expect(symlinked.repoResolvedFrom).toBeUndefined()
  })

  it("names the home it wrote to, so a collapsed isolation is visible in a success", async () => {
    // Four fan-out tasks once landed in a production `~/.rove` behind
    // `failures: []` because the payload never said where it had written.
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    const result = (await invokeVerb("add", ["--repo", "/repo/x"], { client, runtime: stubRuntime() })) as {
      home: string
    }
    expect(result.home).toBe(homeDir())
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
