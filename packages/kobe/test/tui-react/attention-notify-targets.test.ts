import { describe, expect, test } from "vitest"
import type { TaskEngineState } from "../../src/client/remote-orchestrator"
import { notifyTargetStates } from "../../src/tui-react/workspace/use-attention"
import { attentionEdges, attentionKindFor } from "../../src/tui/lib/notify-state"

const es = (state: string, at = 1): TaskEngineState => ({ state, at }) as TaskEngineState

const taskLevel = (entries: Record<string, string>): ReadonlyMap<string, TaskEngineState> =>
  new Map(Object.entries(entries).map(([id, state]) => [id, es(state)]))

const tabLevel = (
  entries: Record<string, Record<string, string>>,
): ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>> =>
  new Map(
    Object.entries(entries).map(([taskId, tabs]) => [
      taskId,
      new Map(Object.entries(tabs).map(([tabId, state]) => [tabId, es(state)])),
    ]),
  )

// Diffing the TASK-level map is not enough: the daemon writes it as a
// last-event-wins rollup, and an edge only fires on a value change, so the
// second of two tabs finishing finds the rollup already at turn_complete and
// never announces itself — two agents done, one toast.
describe("cross-task notify targets", () => {
  test("gives each reporting tab its own entry", () => {
    const { states, targets } = notifyTargetStates(
      taskLevel({ a: "turn_complete" }),
      tabLevel({ a: { "tab-1": "turn_complete", "tab-2": "running" } }),
    )
    expect([...states]).toEqual([
      ["a:tab-1", "turn_complete"],
      ["a:tab-2", "running"],
    ])
    expect(targets.get("a:tab-1")).toEqual({ taskId: "a", tabId: "tab-1" })
  })

  test("falls back to the task rollup when no tab reports (engine with no KOBE_TAB_ID)", () => {
    const { states, targets } = notifyTargetStates(taskLevel({ a: "error" }), tabLevel({}))
    expect([...states]).toEqual([["a:", "error"]])
    expect(targets.get("a:")).toEqual({ taskId: "a", tabId: "" })
  })

  test("never emits both levels for one task", () => {
    const { states } = notifyTargetStates(
      taskLevel({ a: "turn_complete" }),
      tabLevel({ a: { "tab-1": "turn_complete" } }),
    )
    expect([...states.keys()]).toEqual(["a:tab-1"])
  })

  // The case the per-tab grain exists for.
  test("a second tab finishing still fires an edge", () => {
    const rollup = "turn_complete"
    const before = notifyTargetStates(
      taskLevel({ a: rollup }),
      tabLevel({ a: { "tab-1": "turn_complete", "tab-2": "running" } }),
    )
    const after = notifyTargetStates(
      taskLevel({ a: rollup }),
      tabLevel({ a: { "tab-1": "turn_complete", "tab-2": "turn_complete" } }),
    )
    expect(attentionEdges(before.states, after.states, null, attentionKindFor)).toEqual([
      { key: "a:tab-2", kind: "done" },
    ])

    // Task-level only sees no change at all.
    const oldBefore = new Map([["a", rollup]])
    const oldAfter = new Map([["a", rollup]])
    expect(attentionEdges(oldBefore, oldAfter, null, attentionKindFor)).toEqual([])
  })
})
