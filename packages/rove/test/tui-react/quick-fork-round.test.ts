/**
 * The quick-fork ROUND: the two invariants a screenshot cannot show.
 *
 * A round is only a round if every sibling carries the SAME `groupId` — that
 * is the whole difference between `rove api collect --group <id>` finding
 * three attempts and finding nothing at all. And a create that fails partway
 * must leave the siblings already created standing: their engines are already
 * burning tokens, so unwinding them destroys work.
 */

import { planRound } from "@/core/round"
import { type RoundOrchestrator, runQuickForkRound } from "@/tui-react/workspace/quick-fork-round"
import type { Task } from "@/types/task"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/state/repos", () => ({ addSavedRepo: () => {} }))
vi.mock("@/state/vendor-prefs", () => ({ setRepoLastActiveVendor: () => {} }))

describe("planRound", () => {
  it("a single attempt is not a round", () => {
    // A lone fork with a groupId would make `collect --group` report a
    // one-task "round", which is a lie about what the user did.
    expect(planRound(1)).toEqual([{}])
    expect(planRound(1, "Fix auth")).toEqual([{ title: "Fix auth" }])
  })

  it("three attempts share one groupId and carry #i/N ordinals", () => {
    const plan = planRound(3, "Fix auth")
    expect(plan).toHaveLength(3)
    expect(new Set(plan.map((s) => s.groupId)).size).toBe(1)
    expect(plan[0]?.groupId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(plan.map((s) => s.title)).toEqual(["Fix auth #1/3", "Fix auth #2/3", "Fix auth #3/3"])
  })

  it("two calls never share a groupId", () => {
    expect(planRound(2)[0]?.groupId).not.toBe(planRound(2)[0]?.groupId)
  })

  it("clamps a nonsense count to one attempt", () => {
    expect(planRound(0)).toHaveLength(1)
    expect(planRound(-3)).toHaveLength(1)
  })
})

function orchestrator(createTask: RoundOrchestrator["createTask"]): RoundOrchestrator & { prompts: string[] } {
  const prompts: string[] = []
  return {
    createTask,
    setPrompt: async (_id, prompt) => {
      prompts.push(prompt)
    },
    rpc: { request: async <T>() => ({}) as T },
    prompts,
  }
}

const task = (id: string) => ({ id }) as Task

describe("runQuickForkRound", () => {
  it("creates every sibling with one shared groupId, then delivers to each", async () => {
    const seen: Array<{ groupId?: string }> = []
    const orch = orchestrator(async (input) => {
      seen.push({ groupId: input.groupId })
      return task(`t${seen.length}`)
    })
    const delivered: string[] = []
    const outcome = await runQuickForkRound(
      orch,
      "/repo",
      { baseRef: "main", vendor: "claude", prompt: "add subtract", attempts: 3 },
      async (_rpc, id) => {
        delivered.push(id)
        return true
      },
    )
    expect(outcome.started).toEqual(["t1", "t2", "t3"])
    expect(outcome.failures).toEqual([])
    expect(delivered.sort()).toEqual(["t1", "t2", "t3"])
    expect(new Set(seen.map((s) => s.groupId)).size).toBe(1)
    expect(seen[0]?.groupId).toBeTruthy()
    // The brief lands on every sibling, so each is re-runnable in turn.
    expect(orch.prompts).toEqual(["add subtract", "add subtract", "add subtract"])
  })

  it("a create failure at i=2 keeps the first sibling and never returns nothing", async () => {
    let n = 0
    const orch = orchestrator(async () => {
      n += 1
      if (n === 2) throw new Error("store write failed")
      return task(`t${n}`)
    })
    const outcome = await runQuickForkRound(
      orch,
      "/repo",
      { baseRef: "main", vendor: "claude", prompt: "p", attempts: 3 },
      async () => true,
    )
    expect(outcome.created).toEqual(["t1"])
    expect(outcome.started).toEqual(["t1"])
    expect(outcome.failures).toEqual(["create: store write failed"])
  })

  it("a sibling whose prompt never landed is a failure but still a created task", async () => {
    let n = 0
    const orch = orchestrator(async () => task(`t${++n}`))
    const outcome = await runQuickForkRound(
      orch,
      "/repo",
      { baseRef: "main", vendor: "claude", prompt: "p", attempts: 2 },
      // `false` is the honest "session opened, prompt did not land" answer the
      // headless starter gives; it must not read as success.
      async (_rpc, id) => id !== "t2",
    )
    expect(outcome.created).toEqual(["t1", "t2"])
    expect(outcome.started).toEqual(["t1"])
    expect(outcome.failures).toEqual(["t2: prompt not delivered"])
    // The brief still lands on the undelivered sibling — it is the one you
    // want to re-run, and "Run again" reads `task.prompt`.
    expect(orch.prompts).toHaveLength(2)
  })
})
