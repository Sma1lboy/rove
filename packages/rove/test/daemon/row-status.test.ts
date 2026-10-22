/**
 * The daemon decides every rail's status (`row-status.ts`, `row-status-store.ts`);
 * clients only map it to glyphs (`lib/row-status-glyph.ts`).
 */

import { tabStatus, taskStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import { RowStatusStore, type StatusSession } from "@sma1lboy/rove-daemon/daemon/row-status-store"
import { describe, expect, it, vi } from "vitest"
import { rowStatusGlyph } from "../../src/lib/row-status-glyph"

const glyphs = { spinner: ["⠋", "⠙"], idle: "○", unseen: "●", needsInput: "?", attention: "!" }

describe("tab status", () => {
  it("restored and broken outrank running; running outranks a question; a question outranks unseen", () => {
    const running = { activity: { state: "running" as const, at: 5 }, viewed: false }
    expect(tabStatus({ ...running, session: { alive: false, restored: true } }).kind).toBe("attention")
    expect(tabStatus({ activity: { state: "error", at: 5 }, viewed: false })).toMatchObject({
      kind: "attention",
      reason: "error",
    })
    expect(tabStatus(running).kind).toBe("running")
    expect(
      tabStatus({
        activity: { state: "permission_needed", at: 5 },
        pending: { state: "turn_complete", at: 4 },
        viewed: false,
      }).kind,
    ).toBe("needs-input")
  })

  it("unseen is an inbox episode nobody is looking at", () => {
    const done = { activity: { state: "turn_complete" as const, at: 5 }, pending: { state: "turn_complete", at: 5 } }
    expect(tabStatus({ ...done, viewed: false }).kind).toBe("unseen")
    expect(tabStatus({ ...done, viewed: true }).kind).toBe("idle")
    expect(tabStatus({ activity: done.activity, viewed: false }).kind).toBe("idle")
  })

  it("an answered question stops showing until the engine reports again", () => {
    const asking = { activity: { state: "permission_needed" as const, at: 5 }, viewed: false }
    expect(tabStatus({ ...asking, answeredAt: 6 }).kind).toBe("idle")
    expect(tabStatus({ ...asking, answeredAt: 4 }).kind).toBe("needs-input")
  })

  it("the task row takes the most urgent tab; a job or a deletion wins", () => {
    const tabs = {
      "tab-1": tabStatus({ activity: { state: "running", at: 1 }, viewed: false }),
      "tab-2": tabStatus({ activity: { state: "permission_needed", at: 2 }, viewed: false }),
    }
    expect(taskStatus(tabs).kind).toBe("needs-input")
    expect(taskStatus(tabs, { job: { at: 3 } })).toMatchObject({ kind: "busy", reason: "job" })
    expect(taskStatus(tabs, { deletion: { failed: true, at: 3 } })).toMatchObject({
      kind: "attention",
      reason: "delete_failed",
    })
  })
})

describe("one glyph mapping for every client", () => {
  it("maps kinds to the glyph set and the shared tones", () => {
    expect(rowStatusGlyph({ kind: "running", since: 0 }, glyphs, 1)).toEqual({
      glyph: "⠙",
      tone: "accent",
      spinning: true,
    })
    expect(rowStatusGlyph({ kind: "needs-input", since: 0 }, glyphs).glyph).toBe("?")
    expect(rowStatusGlyph({ kind: "attention", reason: "rate_limited", since: 0 }, glyphs).tone).toBe("warning")
    expect(rowStatusGlyph({ kind: "attention", reason: "dead", since: 0 }, glyphs).tone).toBe("error")
    expect(rowStatusGlyph({ kind: "unseen", since: 0 }, glyphs).glyph).toBe("●")
    expect(rowStatusGlyph(undefined, glyphs)).toEqual({ glyph: "○", tone: "muted", spinning: false })
  })
})

describe("the store", () => {
  function harness(sessions: StatusSession[] = []) {
    vi.useFakeTimers()
    const sinks = new Set<(e: { channel: string; payload: unknown }) => void>()
    const published: { tasks: Record<string, unknown>; rev: number }[] = []
    const reads: string[] = []
    const bus = {
      publish: (channel: string, payload: unknown) => {
        if (channel === "row.status") published.push(payload as never)
        for (const s of sinks) s({ channel, payload })
      },
      onPublish: (sink: (e: { channel: string; payload: unknown }) => void) => {
        sinks.add(sink)
        return () => sinks.delete(sink)
      },
      snapshot: () => [],
    }
    const store = new RowStatusStore({
      bus: bus as never,
      listSessions: async () => sessions,
      readEpisode: async (taskId, tabId) => void reads.push(`${taskId}:${tabId}`),
      anyGui: () => true,
      now: () => 1000,
    })
    const emit = (channel: string, payload: unknown) => bus.publish(channel, payload)
    emit("task.snapshot", { tasks: [{ id: "t", repo: "/r" }] })
    const latest = () =>
      published.at(-1)?.tasks.t as {
        task: { kind: string }
        tabs: Record<string, { kind: string; alive: boolean; restored: boolean }>
      }
    return {
      store,
      emit,
      latest,
      reads,
      flush: async () => {
        await vi.advanceTimersByTimeAsync(100)
      },
    }
  }

  it("publishes per-tab status from the ledger, the inbox and the PTY host", async () => {
    const { store, emit, latest, flush } = harness([{ key: "t::tab-2", alive: false, restored: true }])
    emit("engine-state", { taskId: "t", tabId: "tab-1", state: "turn_complete", at: 10 })
    emit("attention.inbox", { items: [{ taskId: "t", tabId: "tab-1", state: "turn_complete", at: 10, unread: true }] })
    await flush()
    expect(latest().tabs["tab-1"]?.kind).toBe("unseen")
    expect(latest().tabs["tab-2"]).toMatchObject({ kind: "attention", restored: true })
    expect(latest().task.kind).toBe("attention")
    store.close()
    vi.useRealTimers()
  })

  it("a viewer looking at a tab clears its inbox episode for every client; leaving stops it", async () => {
    const { store, emit, latest, reads, flush } = harness()
    emit("engine-state", { taskId: "t", tabId: "tab-1", state: "turn_complete", at: 10 })
    emit("attention.inbox", { items: [{ taskId: "t", tabId: "tab-1", state: "turn_complete", at: 10, unread: true }] })
    store.setViewing(7, "", "t", "tab-1")
    await flush()
    expect(reads).toEqual(["t:tab-1"])
    expect(latest().tabs["tab-1"]?.kind).toBe("idle")
    store.dropClient(7)
    await flush()
    expect(latest().tabs["tab-1"]?.kind).toBe("unseen")
    store.close()
    vi.useRealTimers()
  })
})
