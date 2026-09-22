/**
 * `context` tests — the coordinator's start-of-turn read.
 *
 * Pins: rank ordering (the first row is what needs a person next), the
 * unit-of-work filter, repo scoping of the inbox, the `--limit` tail drop,
 * the tri-state liveness, and that a failed side read degrades to an empty
 * section instead of failing the whole verb.
 */

import { resolve } from "node:path"
import type { AttentionInboxItem } from "@sma1lboy/kobe-daemon/daemon/contracts"
import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { type ContextPayload, buildContext } from "../../src/cli/api/context-view.ts"
import { FakeClient, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const NOW = 1_800_000_000_000
// `requireRepo` resolves its flag against the platform's own root, so a bare
// "/repo/x" becomes `D:\repo\x` on Windows and stops matching a fixture that
// spelled it POSIX-style. Resolve once and use the same string on both sides.
const REPO = resolve("/repo/x")
const OTHER = resolve("/repo/y")

function serialized(over: Record<string, unknown> = {}): SerializedTask {
  return taskFixture({ kind: "task", ...over }) as unknown as SerializedTask
}

function base(over: Partial<Parameters<typeof buildContext>[0]> = {}): ContextPayload {
  return buildContext({
    repo: "/repo/x",
    tasks: [],
    activity: null,
    liveTaskIds: null,
    attention: [],
    notes: [],
    now: NOW,
    limit: 20,
    ...over,
  })
}

describe("buildContext", () => {
  it("sorts by derived rank so the first row is what needs a person next", () => {
    const payload = base({
      tasks: [
        serialized({ id: "busy" }),
        serialized({ id: "blocked" }),
        serialized({ id: "quiet" }),
        serialized({
          id: "approved",
          prStatus: { provider: "github", lifecycle: "open", checkState: "passing", reviewDecision: "APPROVED" },
        }),
      ],
      activity: {
        busy: { state: "running", at: NOW - 1_000 },
        blocked: { state: "permission_needed", at: NOW - 5_000 },
        quiet: { state: "idle", at: NOW - 900_000 },
        approved: { state: "idle", at: NOW - 60_000 },
      },
    })
    expect(payload.tasks.map((t) => [t.taskId, t.group])).toEqual([
      ["blocked", "waiting-on-you"],
      ["approved", "landing"],
      ["busy", "working"],
      ["quiet", "idle"],
    ])
  })

  it("answers unknown, never idle, when the activity registry could not be read", () => {
    const payload = base({ tasks: [serialized({ id: "t1" })], activity: null })
    expect(payload.tasks[0]?.group).toBe("unknown")
    expect(payload.tasks[0]?.activity).toBeNull()
  })

  it("drops the quiet tail at --limit and says how many", () => {
    const payload = base({
      tasks: [serialized({ id: "a" }), serialized({ id: "b" }), serialized({ id: "c" })],
      activity: {
        a: { state: "permission_needed", at: NOW },
        b: { state: "idle", at: NOW },
        c: { state: "idle", at: NOW },
      },
      limit: 1,
    })
    expect(payload.tasks.map((t) => t.taskId)).toEqual(["a"])
    expect(payload.omittedTasks).toBe(2)
  })

  it("carries the CI observation and the worker's claim side by side", () => {
    const payload = base({
      tasks: [
        serialized({
          id: "t1",
          prStatus: { provider: "github", lifecycle: "open", checkState: "failing", number: 921 },
          report: { branch: "fix/auth", summary: "done", pr: 921, at: new Date(NOW).toISOString() },
        }),
      ],
      activity: { t1: { state: "idle", at: NOW } },
    })
    expect(payload.tasks[0]).toMatchObject({ checkState: "failing", pr: 921, group: "ready-for-review" })
    expect(payload.tasks[0]?.report?.summary).toBe("done")
  })
})

describe("context handler", () => {
  const runtime = stubRuntime()

  function client(over: Record<string, () => unknown> = {}) {
    return new FakeClient({
      "task.list": () => ({
        tasks: [
          serialized({ id: "work", repo: REPO }),
          // Not units of work: the repo's seat and a directory somebody opened.
          serialized({ id: "seat", kind: "main", repo: REPO }),
          serialized({ id: "dir", kind: "dir", repo: REPO }),
          // Another project.
          serialized({ id: "other", repo: OTHER }),
          // Already being removed — spent.
          serialized({
            id: "going",
            repo: REPO,
            deletion: { phase: "running", force: false, requestedAt: new Date(NOW).toISOString() },
          }),
        ],
      }),
      "debug.inspect": () => ({ activity: { tasks: { work: { state: "running", at: Date.now() } } } }),
      "attention.list": () => ({ items: [] as AttentionInboxItem[] }),
      "note.list": () => ({ notes: [] }),
      ...over,
    })
  }

  it("includes only this repo's live worktree tasks", async () => {
    const result = (await invokeVerb("context", ["--repo", REPO], { client: client(), runtime })) as ContextPayload
    expect(result.tasks.map((t) => t.taskId)).toEqual(["work"])
    expect(result.repo).toBe(REPO)
  })

  it("scopes the inbox to this repo but keeps routine episodes, which have no repo", async () => {
    const items = [
      { taskId: "work", tabId: "tab-1", state: "permission_needed", unread: true, at: NOW },
      { taskId: "other", tabId: "tab-1", state: "error", unread: true, at: NOW },
      { taskId: null, tabId: null, state: "routine_failed", unread: true, at: NOW },
    ] as AttentionInboxItem[]
    const result = (await invokeVerb("context", ["--repo", REPO], {
      client: client({ "attention.list": () => ({ items }) }),
      runtime,
    })) as ContextPayload
    expect(result.attention.map((i) => i.taskId)).toEqual(["work", null])
  })

  it("keeps an inbox episode about the repo's own seat, which the task list filters out", async () => {
    const items = [{ taskId: "seat", tabId: "tab-1", state: "error", unread: true, at: NOW }] as AttentionInboxItem[]
    const result = (await invokeVerb("context", ["--repo", REPO], {
      client: client({ "attention.list": () => ({ items }) }),
      runtime,
    })) as ContextPayload
    expect(result.attention).toHaveLength(1)
  })

  it("degrades a failed side read to an empty section instead of failing the verb", async () => {
    const result = (await invokeVerb("context", ["--repo", REPO], {
      client: client({
        "attention.list": () => {
          throw new Error("no such handler")
        },
        "note.list": () => {
          throw new Error("nope")
        },
      }),
      runtime,
    })) as ContextPayload
    expect(result.attention).toEqual([])
    expect(result.notes).toEqual([])
    expect(result.tasks).toHaveLength(1)
  })

  it("returns { text } and nothing else under --text", async () => {
    const result = (await invokeVerb("context", ["--repo", REPO, "--text"], {
      client: client(),
      runtime,
    })) as { text: string }
    expect(Object.keys(result)).toEqual(["text"])
    expect(result.text).toContain(`repo ${REPO}`)
  })

  it("disbelieves a running claim when the pty host says the task owns nothing live", async () => {
    const result = (await invokeVerb("context", ["--repo", REPO], {
      client: client(),
      runtime: stubRuntime({ liveTaskIds: async () => new Set<string>() }),
    })) as ContextPayload
    expect(result.tasks[0]?.group).not.toBe("working")
  })

  it("keeps believing it when the pty host could not be asked", async () => {
    const result = (await invokeVerb("context", ["--repo", REPO], {
      client: client(),
      runtime: stubRuntime({ liveTaskIds: async () => null }),
    })) as ContextPayload
    expect(result.tasks[0]?.group).toBe("working")
  })
})
