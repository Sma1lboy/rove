/**
 * `send` refuses a `succeeded:` report from a branch with zero commits.
 *
 * The claim and the contradicting evidence are both in hand at the same
 * moment — the sender's own worktree — so this is the loop's earliest honest
 * rejection point. `land`'s EMPTY_BRANCH catches the same mismatch two steps
 * later, after the coordinator has already believed the report.
 *
 * What each test pins is a REFUSAL BOUNDARY, not the happy path: the guard is
 * only allowed to fire on a verified sender, a managed task, and a definite
 * `ahead === 0`. Every other shape must deliver, because a worker blocked
 * from reporting at all is worse than an unverified report.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { type SelfSessionProbe, resetVerifiedSelfSession, verifiedSelfSession } from "../../src/cli/api/dispatcher.ts"
import { FakeClient, expectApiError, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const savedTaskId = process.env.KOBE_TASK_ID
const savedTabId = process.env.KOBE_TAB_ID

function restoreEnv(name: string, saved: string | undefined): void {
  if (saved === undefined) delete process.env[name]
  else process.env[name] = saved
}

/** A process tree where this process descends from the session's shell. */
function probeFor(key: string, opts: { detached?: boolean } = {}): SelfSessionProbe {
  const shellPid = 100
  return {
    sessions: async () => [{ key, pid: shellPid, alive: true }],
    ps: async () =>
      opts.detached
        ? `  ${shellPid}     1 /bin/zsh -il\n  500     1 bun kobe api send`
        : `  ${shellPid}     1 /bin/zsh -il\n  500   ${shellPid} bun kobe api send`,
    pid: 500,
  }
}

async function asSession(taskId: string, tabId: string, opts?: { detached?: boolean }): Promise<void> {
  await verifiedSelfSession({ KOBE_TASK_ID: taskId, KOBE_TAB_ID: tabId }, probeFor(`${taskId}::${tabId}`, opts))
}

/** Sender is `worker-1`; every other id answers as the coordinator. */
function clientWith(senderOverrides: Record<string, unknown> = {}): FakeClient {
  return new FakeClient({
    "task.get": (payload) => {
      const { taskId } = payload as { taskId: string }
      if (taskId === "worker-1") {
        return { task: taskFixture({ id: "worker-1", branch: "fix/thing", kind: "task", ...senderOverrides }) }
      }
      return { task: taskFixture({ id: taskId, title: "Coordinator" }) }
    },
  })
}

/** The signal that makes the guard fire: a resolvable base, zero commits. */
const emptyBranch = { readBranchSignals: async () => ({ baseRef: "origin/main", ahead: 0, diff: null }) }

beforeEach(async () => {
  resetVerifiedSelfSession()
  process.env.KOBE_TASK_ID = "worker-1"
  process.env.KOBE_TAB_ID = "tab-1"
  await asSession("worker-1", "tab-1")
})

afterEach(() => {
  resetVerifiedSelfSession()
  restoreEnv("KOBE_TASK_ID", savedTaskId)
  restoreEnv("KOBE_TAB_ID", savedTabId)
})

describe("send refuses an empty-branch success report", () => {
  it("rejects `succeeded:` from a managed task with 0 commits, and delivers NOTHING", async () => {
    const { calls, deliver } = recordingDelivery()
    await expectApiError(
      () =>
        invokeVerb("send", ["--task-id", "coord-1", "--prompt", "succeeded: all tests pass, CI green"], {
          client: clientWith(),
          runtime: stubRuntime({ deliverPrompt: deliver, ...emptyBranch }),
        }),
      "EMPTY_SUCCESS_REPORT",
      /fix\/thing has 0 commits/,
    )
    // The refusal is only worth anything if the false claim never lands.
    expect(calls).toHaveLength(0)
  })

  it("hands back an executable recovery path naming the escape hatch", async () => {
    const { deliver } = recordingDelivery()
    try {
      await invokeVerb("send", ["--task-id", "coord-1", "--prompt", "succeeded: done"], {
        client: clientWith(),
        runtime: stubRuntime({ deliverPrompt: deliver, ...emptyBranch }),
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      const data = (error as { data?: Record<string, unknown> }).data ?? {}
      expect(data.branch).toBe("fix/thing")
      expect(String(data.hint)).toMatch(/commit your work/)
      // The retry argv must be runnable verbatim, carrying the original text.
      expect(data.nextCommandArgs).toEqual(["api", "send", "--allow-empty", "--prompt", "succeeded: done"])
    }
  })

  it("--allow-empty is the deliberate empty success (an investigation, a review)", async () => {
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("send", ["--task-id", "coord-1", "--allow-empty", "--prompt", "succeeded: no bug, see notes"], {
      client: clientWith(),
      runtime: stubRuntime({ deliverPrompt: deliver, ...emptyBranch }),
    })
    expect(calls).toHaveLength(1)
  })

  it("a FULLWIDTH colon — what a CJK IME types, and what this repo's agents write", async () => {
    const { calls, deliver } = recordingDelivery()
    await expectApiError(
      () =>
        invokeVerb("send", ["--task-id", "coord-1", "--prompt", "succeeded：全部通过，CI 绿了"], {
          client: clientWith(),
          runtime: stubRuntime({ deliverPrompt: deliver, ...emptyBranch }),
        }),
      "EMPTY_SUCCESS_REPORT",
    )
    expect(calls).toHaveLength(0)
  })

  it("--plain is not an escape hatch — a verbatim false claim is the same false claim", async () => {
    const { calls, deliver } = recordingDelivery()
    await expectApiError(
      () =>
        invokeVerb("send", ["--task-id", "coord-1", "--plain", "--prompt", "succeeded: done"], {
          client: clientWith(),
          runtime: stubRuntime({ deliverPrompt: deliver, ...emptyBranch }),
        }),
      "EMPTY_SUCCESS_REPORT",
    )
    expect(calls).toHaveLength(0)
  })
})

describe("send delivers everything the guard has no business refusing", () => {
  it("a `failed:` report — the whole point is that it reports having nothing", async () => {
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("send", ["--task-id", "coord-1", "--prompt", "failed: blocked on a missing credential"], {
      client: clientWith(),
      runtime: stubRuntime({ deliverPrompt: deliver, ...emptyBranch }),
    })
    expect(calls).toHaveLength(1)
  })

  it("a `succeeded:` report WITH commits", async () => {
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("send", ["--task-id", "coord-1", "--prompt", "succeeded: fixed it"], {
      client: clientWith(),
      runtime: stubRuntime({
        deliverPrompt: deliver,
        readBranchSignals: async () => ({ baseRef: "origin/main", ahead: 3, diff: null }),
      }),
    })
    expect(calls).toHaveLength(1)
  })

  it("an UNRESOLVABLE base (ahead: null) — an honest unknown is never grounds to refuse", async () => {
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("send", ["--task-id", "coord-1", "--prompt", "succeeded: done"], {
      client: clientWith(),
      runtime: stubRuntime({
        deliverPrompt: deliver,
        readBranchSignals: async () => ({ baseRef: null, ahead: null, diff: null }),
      }),
    })
    expect(calls).toHaveLength(1)
  })

  it("a `main` task — a project-main checkout owns no Rove branch to be empty", async () => {
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("send", ["--task-id", "coord-1", "--prompt", "succeeded: done"], {
      client: clientWith({ kind: "main" }),
      runtime: stubRuntime({ deliverPrompt: deliver, ...emptyBranch }),
    })
    expect(calls).toHaveLength(1)
  })

  it("a `dir` task — likewise a user-owned directory, not a Rove branch", async () => {
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("send", ["--task-id", "coord-1", "--prompt", "succeeded: done"], {
      client: clientWith({ kind: "dir" }),
      runtime: stubRuntime({ deliverPrompt: deliver, ...emptyBranch }),
    })
    expect(calls).toHaveLength(1)
  })

  it("an UNVERIFIED session — an inherited env names a stranger's branch, never a refusal", async () => {
    resetVerifiedSelfSession()
    await asSession("worker-1", "tab-1", { detached: true })
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("send", ["--task-id", "coord-1", "--prompt", "succeeded: done"], {
      client: clientWith(),
      runtime: stubRuntime({ deliverPrompt: deliver, ...emptyBranch }),
    })
    expect(calls).toHaveLength(1)
  })

  it("a branch read that THROWS — every failure mode here is an unknown", async () => {
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("send", ["--task-id", "coord-1", "--prompt", "succeeded: done"], {
      client: clientWith(),
      runtime: stubRuntime({
        deliverPrompt: deliver,
        readBranchSignals: async () => {
          throw new Error("git exploded")
        },
      }),
    })
    expect(calls).toHaveLength(1)
  })

  it("prose that merely mentions the word, rather than opening with the marker", async () => {
    const { calls, deliver } = recordingDelivery()
    await invokeVerb("send", ["--task-id", "coord-1", "--prompt", "the build succeeded: here is the log"], {
      client: clientWith(),
      runtime: stubRuntime({ deliverPrompt: deliver, ...emptyBranch }),
    })
    expect(calls).toHaveLength(1)
  })
})
