import { describe, expect, it } from "vitest"
import {
  DEAD_SETTLE_MS,
  ERROR_SETTLE_MS,
  TASK_GROUPS,
  type TaskActivitySignal,
  deriveTaskGroup,
  taskGroupRank,
} from "../../src/lib/task-group.ts"
import { type Task, toTaskId } from "../../src/types/task.ts"

const NOW = 1_800_000_000_000

function task(over: Partial<Task> = {}): Task {
  return {
    id: toTaskId("01J000000000000000000000"),
    title: "simplify auth",
    repo: "/repo",
    branch: "fix/auth",
    worktreePath: "/wt",
    status: "in_progress",
    createdAt: new Date(NOW - 3_600_000).toISOString(),
    updatedAt: new Date(NOW - 60_000).toISOString(),
    ...over,
  }
}

function act(state: TaskActivitySignal["state"], agoMs = 0): TaskActivitySignal {
  return { state, at: NOW - agoMs }
}

describe("taskGroupRank", () => {
  it("ranks the human's queue most-needs-you first", () => {
    expect(TASK_GROUPS.map(taskGroupRank)).toEqual([0, 1, 2, 3, 4, 5])
    expect(taskGroupRank("waiting-on-you")).toBeLessThan(taskGroupRank("landing"))
    expect(taskGroupRank("landing")).toBeLessThan(taskGroupRank("ready-for-review"))
    expect(taskGroupRank("ready-for-review")).toBeLessThan(taskGroupRank("working"))
    expect(taskGroupRank("idle")).toBeLessThan(taskGroupRank("unknown"))
  })
})

describe("deriveTaskGroup — waiting on you", () => {
  it("fires on a permission prompt with no debounce", () => {
    expect(deriveTaskGroup({ task: task(), activity: act("permission_needed"), now: NOW })).toBe("waiting-on-you")
  })

  it("fires on a rate limit nothing will clear on its own", () => {
    expect(deriveTaskGroup({ task: task(), activity: act("rate_limited"), now: NOW })).toBe("waiting-on-you")
  })

  it("does NOT fire on a rate limit the daemon has scheduled a resume for", () => {
    const quotaResume = {
      resumeAt: new Date(NOW + 600_000).toISOString(),
      requestedAt: new Date(NOW - 10_000).toISOString(),
    }
    expect(deriveTaskGroup({ task: task({ quotaResume }), activity: act("rate_limited"), now: NOW })).toBe("working")
  })

  it("fires again once the scheduled resume window has passed", () => {
    const quotaResume = {
      resumeAt: new Date(NOW - 1_000).toISOString(),
      requestedAt: new Date(NOW - 600_000).toISOString(),
    }
    expect(deriveTaskGroup({ task: task({ quotaResume }), activity: act("rate_limited"), now: NOW })).toBe(
      "waiting-on-you",
    )
  })

  it("debounces a fresh error — an engine that retries itself must not summon anyone", () => {
    expect(deriveTaskGroup({ task: task(), activity: act("error", ERROR_SETTLE_MS - 1), now: NOW })).not.toBe(
      "waiting-on-you",
    )
    expect(deriveTaskGroup({ task: task(), activity: act("error", ERROR_SETTLE_MS), now: NOW })).toBe("waiting-on-you")
  })

  it("fires on a dead tab that delivered nothing, after one walk cadence", () => {
    expect(deriveTaskGroup({ task: task(), activity: act("dead", DEAD_SETTLE_MS - 1), now: NOW })).not.toBe(
      "waiting-on-you",
    )
    expect(deriveTaskGroup({ task: task(), activity: act("dead", DEAD_SETTLE_MS), now: NOW })).toBe("waiting-on-you")
  })

  it("does not fire for a dead tab that DID deliver — that is a review, not a rescue", () => {
    const report = { branch: "fix/auth", at: new Date(NOW - 120_000).toISOString() }
    expect(deriveTaskGroup({ task: task({ report }), activity: act("dead", DEAD_SETTLE_MS), now: NOW })).toBe(
      "ready-for-review",
    )
  })

  it("treats a settled not-alive tab like a dead one", () => {
    expect(deriveTaskGroup({ task: task(), activity: act("idle", DEAD_SETTLE_MS), tabAlive: false, now: NOW })).toBe(
      "waiting-on-you",
    )
  })

  it("never derives a dead tab from the ABSENCE of an activity signal", () => {
    // No activity record at all: a crashed engine and a task whose engine
    // never started look identical, so neither may be claimed.
    expect(deriveTaskGroup({ task: task(), tabAlive: false, now: NOW })).toBe("unknown")
  })

  it("fires when background worktree deletion failed", () => {
    const deletion = { phase: "error", force: false, requestedAt: new Date(NOW).toISOString() } as const
    expect(deriveTaskGroup({ task: task({ deletion }), activity: act("idle"), now: NOW })).toBe("waiting-on-you")
  })
})

describe("deriveTaskGroup — working", () => {
  it("outranks a stale PR approval in MATCH order — the diff is still moving", () => {
    const prStatus = {
      provider: "github",
      lifecycle: "open",
      checkState: "passing",
      reviewDecision: "APPROVED",
    } as const
    expect(deriveTaskGroup({ task: task({ prStatus }), activity: act("running"), now: NOW })).toBe("working")
    // …and still sorts BELOW the groups that need a person.
    expect(taskGroupRank("working")).toBeGreaterThan(taskGroupRank("landing"))
  })

  it("disbelieves a running claim about a tab the pty host says is not alive", () => {
    expect(deriveTaskGroup({ task: task(), activity: act("running"), tabAlive: false, now: NOW })).not.toBe("working")
  })

  it("keeps believing a running claim when liveness could not be read", () => {
    expect(deriveTaskGroup({ task: task(), activity: act("running"), tabAlive: null, now: NOW })).toBe("working")
  })
})

describe("deriveTaskGroup — landing", () => {
  const approved = {
    provider: "github",
    lifecycle: "open",
    checkState: "passing",
    reviewDecision: "APPROVED",
  } as const

  it("is an open, approved PR", () => {
    expect(deriveTaskGroup({ task: task({ prStatus: approved }), activity: act("idle"), now: NOW })).toBe("landing")
  })
})

describe("deriveTaskGroup — ready for review", () => {
  const report = { branch: "fix/auth", summary: "done", at: new Date(NOW - 30_000).toISOString() }

  it("is a report nobody has acted on", () => {
    expect(deriveTaskGroup({ task: task({ report }), activity: act("idle"), now: NOW })).toBe("ready-for-review")
  })

  it("is also a finished turn with no report", () => {
    expect(deriveTaskGroup({ task: task(), activity: act("turn_complete"), now: NOW })).toBe("ready-for-review")
  })

  it("clears once the task is marked done", () => {
    expect(deriveTaskGroup({ task: task({ report, status: "done" }), activity: act("idle"), now: NOW })).toBe("idle")
  })
})

describe("deriveTaskGroup — absence is not a verdict", () => {
  it("answers unknown when the engine signal could not be read", () => {
    expect(deriveTaskGroup({ task: task(), now: NOW })).toBe("unknown")
    expect(deriveTaskGroup({ task: task(), activity: null, now: NOW })).toBe("unknown")
  })

  it("does not buy `idle` with a stored PR observation alone", () => {
    const prStatus = { provider: "github", lifecycle: "open", checkState: "pending" } as const
    expect(deriveTaskGroup({ task: task({ prStatus }), now: NOW })).toBe("unknown")
  })

  it("clamps a future activity timestamp instead of going negative", () => {
    expect(deriveTaskGroup({ task: task(), activity: act("error", -5_000), now: NOW })).toBe("idle")
  })
})
