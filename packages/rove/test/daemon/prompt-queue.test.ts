/**
 * `send --queue`: a prompt for a busy tab waits for that tab's turn to end, one per turn, and is never
 * pasted into a permission menu, even when a turn-end event arrives while the menu is still up. Codex drops
 * the work in flight when a prompt lands mid-turn, and Enter into a menu confirms its highlighted option.
 */

import assert from "node:assert"
import { describe, expect, it, vi } from "vitest"
import type { TaskActivityState } from "../../../rove-daemon/src/daemon/attention-contracts.ts"
import { DaemonEventBus } from "../../../rove-daemon/src/daemon/event-bus.ts"
import { heldBack } from "../../../rove-daemon/src/daemon/handlers-queue.ts"
import { PromptQueue, type QueuedPrompt } from "../../../rove-daemon/src/daemon/prompt-queue.ts"

/** `deliver` behaves as `pasteQueued`: it re-reads the tab and holds back while it is at a menu or busy. */
function harness(initial: TaskActivityState | undefined, opts: { landed?: () => boolean; gated?: boolean } = {}) {
  const bus = new DaemonEventBus()
  let state = initial
  const pasted: string[] = []
  let gate = Promise.withResolvers<void>()
  let settles = 0
  const queue = new PromptQueue(
    bus,
    () => state,
    async (item: QueuedPrompt) => {
      const blocked = heldBack({ activity: { stateOf: () => state } as never, rowStatus: undefined }, item)
      if (blocked) return blocked
      if (opts.landed && !opts.landed()) return "no-engine"
      pasted.push(item.text)
      return null
    },
    Date.now,
    () => {
      // Called synchronously when a hand-over starts, before anything is pasted.
      settles++
      return opts.gated ? gate.promise : Promise.resolve()
    },
  )
  const to = (next: TaskActivityState) => {
    state = next
    bus.publish("engine-state", { taskId: "t", tabId: "tab-1", state: next, at: 0 })
  }
  // The reading changes with no event: no turn edge was seen.
  const quietly = (next: TaskActivityState) => {
    state = next
  }
  const release = () => {
    gate.resolve()
    gate = Promise.withResolvers<void>()
  }
  return { queue, pasted, to, quietly, release, attempts: () => settles }
}

describe("PromptQueue", () => {
  it("lets an idle tab take the prompt now", () => {
    const { queue } = harness("turn_complete")
    expect(queue.add({ taskId: "t", tabId: "tab-1", text: "now" })).toEqual({ queued: false })
    expect(queue.list()).toEqual([])
  })

  it("holds a prompt for a running tab until its turn ends, then pastes it once", async () => {
    const { queue, pasted, to } = harness("running")
    expect(queue.add({ taskId: "t", tabId: "tab-1", text: "next" })).toMatchObject({ queued: true, position: 1 })
    to("running")
    expect(pasted).toEqual([])
    to("turn_complete")
    await vi.waitFor(() => expect(queue.list()).toEqual([]))
    to("idle")
    expect(pasted).toEqual(["next"])
  })

  it("never pastes into a permission menu; the turn has to end first", async () => {
    const { queue, pasted, to } = harness("running")
    queue.add({ taskId: "t", tabId: "tab-1", text: "after" })
    to("permission_needed")
    to("running")
    expect(pasted).toEqual([])
    to("turn_complete")
    await vi.waitFor(() => expect(pasted).toEqual(["after"]))
  })

  it("hands nothing over on a Stop that comes straight from a menu", async () => {
    const { queue, pasted, to, attempts } = harness("permission_needed")
    queue.add({ taskId: "t", tabId: "tab-1", text: "after" })
    // The menu is still drawn: Enter would confirm its highlighted option, so no hand-over may even start.
    to("turn_complete")
    expect(attempts()).toBe(0)
    expect(queue.list()).toMatchObject([{ text: "after" }])
    // A real approval reports `running`, then its Stop: that turn end hands it over.
    to("running")
    to("turn_complete")
    await vi.waitFor(() => expect(pasted).toEqual(["after"]))
  })

  it("does not paste when the tab is back at a menu by the time the turn end settles", async () => {
    const { queue, pasted, to, quietly, release } = harness("running", { gated: true })
    queue.add({ taskId: "t", tabId: "tab-1", text: "after" })
    // The turn ends and the next menu's event lands before the paste.
    to("turn_complete")
    quietly("permission_needed")
    release()
    await vi.waitFor(() => expect(queue.list()).toMatchObject([{ text: "after", lastError: "awaiting-permission" }]))
    expect(pasted).toEqual([])
    // Answered, that turn works and ends: the held-back prompt goes then.
    to("running")
    to("turn_complete")
    release()
    await vi.waitFor(() => expect(pasted).toEqual(["after"]))
  })

  it("hands over one prompt per turn, in order", async () => {
    const { queue, pasted, to } = harness("running")
    queue.add({ taskId: "t", tabId: "tab-1", text: "one" })
    expect(queue.add({ taskId: "t", tabId: "tab-1", text: "two" })).toMatchObject({ position: 2 })
    to("turn_complete")
    await vi.waitFor(() => expect(queue.list()).toHaveLength(1))
    expect(pasted).toEqual(["one"])
    to("running")
    to("turn_complete")
    await vi.waitFor(() => expect(pasted).toEqual(["one", "two"]))
  })

  it("queues behind held prompts even when the tab looks idle", () => {
    const { queue, pasted, quietly } = harness("running")
    queue.add({ taskId: "t", tabId: "tab-1", text: "one" })
    quietly("idle")
    expect(queue.add({ taskId: "t", tabId: "tab-1", text: "two" })).toMatchObject({ queued: true, position: 2 })
    expect(pasted).toEqual([])
  })

  it("keeps a prompt that did not land, with the reason, and drops a cancelled one", async () => {
    const { queue, pasted, to } = harness("running", { landed: () => false })
    const added = queue.add({ taskId: "t", tabId: "tab-1", text: "lost?" })
    to("turn_complete")
    await vi.waitFor(() => expect(queue.list()).toMatchObject([{ text: "lost?", lastError: "no-engine" }]))
    expect(pasted).toEqual([])
    assert(added.queued)
    expect(queue.cancel(added.item.id)).toBe(true)
    expect(queue.list()).toEqual([])
  })

  it("edits a held prompt in place: same id, same place in line, new text pasted", async () => {
    const { queue, pasted, to } = harness("running")
    const first = queue.add({ taskId: "t", tabId: "tab-1", text: "one" })
    queue.add({ taskId: "t", tabId: "tab-1", text: "two" })
    assert(first.queued)
    expect(queue.edit(first.item.id, "one, fixed")).toMatchObject({ edited: true, item: { id: first.item.id } })
    expect(queue.list().map((i) => i.text)).toEqual(["one, fixed", "two"])
    to("turn_complete")
    await vi.waitFor(() => expect(pasted).toEqual(["one, fixed"]))
    expect(queue.edit(first.item.id, "too late")).toEqual({ edited: false, reason: "not-found" })
  })

  it("refuses to edit a prompt whose paste has started, so the reply never claims text that did not land", async () => {
    const bus = new DaemonEventBus()
    const landing = Promise.withResolvers<string | null>()
    const pasted: string[] = []
    const queue = new PromptQueue(
      bus,
      () => "running",
      (item) => {
        pasted.push(item.text)
        return landing.promise
      },
      Date.now,
      () => Promise.resolve(),
    )
    const added = queue.add({ taskId: "t", tabId: "tab-1", text: "old" })
    assert(added.queued)
    bus.publish("engine-state", { taskId: "t", tabId: "tab-1", state: "turn_complete", at: 0 })
    await vi.waitFor(() => expect(pasted).toEqual(["old"]))
    expect(queue.edit(added.item.id, "new")).toEqual({ edited: false, reason: "pasting" })
    landing.resolve(null)
    await vi.waitFor(() => expect(queue.list()).toEqual([]))
  })
})

describe("heldBack", () => {
  const item = { id: "q-1", taskId: "t", tabId: "tab-1", text: "x", expectReport: false, at: 0 }
  const ctx = (state: TaskActivityState | undefined, kind?: string) =>
    ({
      activity: { stateOf: () => state },
      rowStatus: { list: () => ({ tasks: { t: { tabs: { "tab-1": { kind } } } } }) },
    }) as never

  it("refuses a menu by either signal send refuses on, and a running turn", () => {
    expect(heldBack(ctx("permission_needed"), item)).toBe("awaiting-permission")
    expect(heldBack(ctx("turn_complete", "needs-input"), item)).toBe("awaiting-permission")
    expect(heldBack(ctx("running"), item)).toBe("busy")
    expect(heldBack(ctx("turn_complete", "idle"), item)).toBeNull()
  })
})
