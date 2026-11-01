/**
 * `send --queue`: a prompt for a busy tab waits for that tab's turn to end, one per turn, and is never
 * pasted into a permission menu. Codex drops the work in flight when a prompt lands mid-turn, so a hand-over
 * at the wrong moment is lost work, not just bad ordering.
 */

import { describe, expect, it, vi } from "vitest"
import type { TaskActivityState } from "../../../rove-daemon/src/daemon/attention-contracts.ts"
import { DaemonEventBus } from "../../../rove-daemon/src/daemon/event-bus.ts"
import { PromptQueue, type QueuedPrompt } from "../../../rove-daemon/src/daemon/prompt-queue.ts"

function harness(initial: TaskActivityState | undefined, outcome: () => string | null = () => null) {
  const bus = new DaemonEventBus()
  let state = initial
  const pasted: string[] = []
  const queue = new PromptQueue(
    bus,
    () => state,
    // Called synchronously from the state event; only the list update after it waits a tick.
    async (item: QueuedPrompt) => {
      const error = outcome()
      if (error === null) pasted.push(item.text)
      return error
    },
  )
  const to = (next: TaskActivityState) => {
    state = next
    bus.publish("engine-state", { taskId: "t", tabId: "tab-1", state: next, at: 0 })
  }
  const settled = (count: number) => vi.waitFor(() => expect(queue.list()).toHaveLength(count))
  // The reading changes with no event: no turn edge was seen.
  const quietly = (next: TaskActivityState) => {
    state = next
  }
  return { queue, pasted, to, settled, quietly }
}

describe("PromptQueue", () => {
  it("lets an idle tab take the prompt now", () => {
    const { queue } = harness("turn_complete")
    expect(queue.add({ taskId: "t", tabId: "tab-1", text: "now" })).toEqual({ queued: false })
    expect(queue.list()).toEqual([])
  })

  it("holds a prompt for a running tab until its turn ends, then pastes it once", async () => {
    const { queue, pasted, to, settled } = harness("running")
    expect(queue.add({ taskId: "t", tabId: "tab-1", text: "next" })).toMatchObject({ queued: true, position: 1 })
    to("running")
    expect(pasted).toEqual([])
    to("turn_complete")
    expect(pasted).toEqual(["next"])
    await settled(0)
    to("idle")
    expect(pasted).toEqual(["next"])
  })

  it("never pastes into a permission menu; the turn has to end first", () => {
    const { queue, pasted, to } = harness("running")
    queue.add({ taskId: "t", tabId: "tab-1", text: "after" })
    to("permission_needed")
    to("running")
    expect(pasted).toEqual([])
    to("turn_complete")
    expect(pasted).toEqual(["after"])
  })

  it("hands over one prompt per turn, in order", async () => {
    const { queue, pasted, to, settled } = harness("running")
    queue.add({ taskId: "t", tabId: "tab-1", text: "one" })
    expect(queue.add({ taskId: "t", tabId: "tab-1", text: "two" })).toMatchObject({ position: 2 })
    to("turn_complete")
    expect(pasted).toEqual(["one"])
    await settled(1)
    to("running")
    to("turn_complete")
    expect(pasted).toEqual(["one", "two"])
  })

  it("queues behind held prompts even when the tab looks idle", () => {
    const { queue, pasted, quietly } = harness("running")
    queue.add({ taskId: "t", tabId: "tab-1", text: "one" })
    quietly("idle")
    expect(queue.add({ taskId: "t", tabId: "tab-1", text: "two" })).toMatchObject({ queued: true, position: 2 })
    expect(pasted).toEqual([])
  })

  it("keeps a prompt that did not land, with the reason, and drops a cancelled one", async () => {
    const { queue, pasted, to } = harness("running", () => "no-engine")
    const added = queue.add({ taskId: "t", tabId: "tab-1", text: "lost?" })
    to("turn_complete")
    expect(pasted).toEqual([])
    await vi.waitFor(() => expect(queue.list()).toMatchObject([{ text: "lost?", lastError: "no-engine" }]))
    if (!added.queued) throw new Error("expected queued")
    expect(queue.cancel(added.item.id)).toBe(true)
    expect(queue.list()).toEqual([])
  })
})
