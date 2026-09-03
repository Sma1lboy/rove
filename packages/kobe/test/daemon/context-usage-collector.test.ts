/**
 * The context-usage collector: which live sessions it reads, and the publish
 * gate. The reader is injected, so no transcripts are involved.
 */

import {
  ContextUsageCollector,
  contextUsageTargets,
  sameContextUsage,
} from "@sma1lboy/kobe-daemon/daemon/context-usage-collector"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import { describe, expect, test } from "vitest"

const FAST = { timeoutMs: 1_000, slowRetryMs: 1_000, minIntervalMs: 0 }
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

describe("contextUsageTargets", () => {
  const vendorOf = (id: string) => (id === "gone" ? undefined : ("claude" as const))

  test("keeps only per-TAB entries that name a session", () => {
    // A task-level entry cannot say which of its tabs the number belongs to,
    // and the footer meter is about the tab you are looking at.
    expect(
      contextUsageTargets(
        [
          { taskId: "t1", tabId: "tab-1", sessionId: "s1" },
          { taskId: "t1", sessionId: "s1" },
          { taskId: "t1", tabId: "tab-2" },
        ],
        vendorOf,
      ),
    ).toEqual([{ key: "t1::tab-1", vendor: "claude", sessionId: "s1" }])
  })

  test("skips a session whose task is gone — the registry outlives a delete", () => {
    expect(contextUsageTargets([{ taskId: "gone", tabId: "tab-1", sessionId: "s1" }], vendorOf)).toEqual([])
  })

  test("dedupes repeated entries for the same tab, first one wins", () => {
    const targets = contextUsageTargets(
      [
        { taskId: "t1", tabId: "tab-1", sessionId: "first" },
        { taskId: "t1", tabId: "tab-1", sessionId: "second" },
      ],
      vendorOf,
    )
    expect(targets).toHaveLength(1)
    expect(targets[0]?.sessionId).toBe("first")
  })
})

describe("sameContextUsage", () => {
  test("distinguishes an estimate from an engine-reported figure of the same size", () => {
    const exact = { contextTokens: 10, contextWindowTokens: 100 }
    expect(sameContextUsage(exact, { ...exact })).toBe(true)
    expect(sameContextUsage(exact, { ...exact, approximate: true })).toBe(false)
    expect(sameContextUsage(exact, { ...exact, contextWindowTokens: 200 })).toBe(false)
  })
})

function harness(states: { taskId: string; tabId?: string; sessionId?: string }[]) {
  const bus = new DaemonEventBus()
  const published: { context: Record<string, unknown> }[] = []
  bus.onPublish((event) => {
    if (event.channel === "usage.context") published.push(event.payload as { context: Record<string, unknown> })
  })
  let live = states
  let value: { contextTokens: number; contextWindowTokens?: number } | null = {
    contextTokens: 10,
    contextWindowTokens: 100,
  }
  const collector = new ContextUsageCollector(
    { currentNonIdle: () => live as never },
    { getTask: () => ({ vendor: "claude" }) as never },
    bus,
    { readEngineContextUsage: async () => value },
    { cadence: FAST, read: async () => value },
  )
  return {
    collector,
    published,
    setLive: (next: typeof states) => {
      live = next
    },
    setValue: (next: typeof value) => {
      value = next
    },
  }
}

describe("ContextUsageCollector", () => {
  test("publishes once per real change, and not on an unchanged tick", async () => {
    const h = harness([{ taskId: "t1", tabId: "tab-1", sessionId: "s1" }])
    h.collector.tick()
    await settle()
    expect(h.published.at(-1)?.context).toEqual({ "t1::tab-1": { contextTokens: 10, contextWindowTokens: 100 } })

    h.collector.tick()
    await settle()
    expect(h.published).toHaveLength(1)

    h.setValue({ contextTokens: 60, contextWindowTokens: 100 })
    h.collector.tick()
    await settle()
    expect(h.published).toHaveLength(2)
    expect(h.published.at(-1)?.context).toEqual({ "t1::tab-1": { contextTokens: 60, contextWindowTokens: 100 } })
  })

  test("a null reading never publishes — 'not reported' is not zero", async () => {
    const h = harness([{ taskId: "t1", tabId: "tab-1", sessionId: "s1" }])
    h.setValue(null)
    h.collector.tick()
    await settle()
    expect(h.published).toEqual([])
  })

  test("a closed tab drops out of the map on the next tick", async () => {
    const h = harness([{ taskId: "t1", tabId: "tab-1", sessionId: "s1" }])
    h.collector.tick()
    await settle()
    expect(Object.keys(h.published.at(-1)?.context ?? {})).toEqual(["t1::tab-1"])

    h.setLive([])
    h.collector.tick()
    await settle()
    expect(h.published.at(-1)?.context).toEqual({})
  })

  test("a NEW session in the same tab drops the old reading rather than showing it", async () => {
    // Otherwise a fresh conversation reports the previous one's occupancy
    // until the next read lands — the worst moment to be wrong about it.
    const h = harness([{ taskId: "t1", tabId: "tab-1", sessionId: "s1" }])
    h.collector.tick()
    await settle()
    h.setLive([{ taskId: "t1", tabId: "tab-1", sessionId: "s2" }])
    h.setValue(null)
    h.collector.tick()
    await settle()
    expect(h.published.at(-1)?.context).toEqual({})
  })
})
