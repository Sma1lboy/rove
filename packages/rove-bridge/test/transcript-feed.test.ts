import { afterEach, describe, expect, test } from "bun:test"
import { BridgeError, type TranscriptUpdatePush } from "../src/protocol.ts"
import { TranscriptFeed } from "../src/transcript-feed.ts"
import { AUTH, connect, start, stopServers } from "./server-harness.ts"

afterEach(stopServers)

/** Wait until a condition becomes true via microtask/event-loop turns (no fixed sleeps). */
async function waitUntil(check: () => boolean, limit = 50): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (check()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error("waitUntil timed out")
}

describe("TranscriptFeed", () => {
  test("pushes incremental messages on poke and skips no-op polls", async () => {
    let seq = 0
    const firstDone = Promise.withResolvers<void>()
    const secondDone = Promise.withResolvers<void>()
    const feed = new TranscriptFeed({
      debounceMs: 0,
      readOutput: async ({ cursor }) => {
        seq++
        if (seq === 1) {
          firstDone.resolve()
          return {
            source: "history",
            history: {
              sessionId: "s1",
              messages: [
                { role: "assistant", timestamp: "2026-11-28T00:00:01Z", blocks: [{ type: "text", text: "Hi" }] },
              ],
              firstIndex: 1,
              totalMessages: 2,
            },
            cursor: "c2",
          }
        }
        secondDone.resolve()
        return {
          source: "history",
          history: { sessionId: "s1", messages: [], firstIndex: 2, totalMessages: 2 },
          cursor: cursor ?? "c2",
        }
      },
    })

    const received: TranscriptUpdatePush[] = []
    const unsub = feed.subscribe({ taskId: "T1", cursor: "c1" }, (u) => received.push(u))

    feed.poke("T1")
    await firstDone.promise
    await waitUntil(() => received.length === 1)
    expect(received[0]?.cursor).toBe("c2")
    expect(received[0]?.history?.firstIndex).toBe(1)

    // Second poke with no new messages and unchanged cursor emits nothing.
    feed.poke("T1")
    await secondDone.promise
    await new Promise((resolve) => setImmediate(resolve))
    expect(received).toHaveLength(1)

    unsub()
    expect(feed.watchedCount).toBe(0)
  })

  test("file watcher triggers incremental pushes and tears down on last unsubscribe", async () => {
    const watchReady = Promise.withResolvers<() => void>()
    let stopped = false
    const feed = new TranscriptFeed({
      debounceMs: 0,
      resolveWatchPath: async () => "/tmp/fake-session.jsonl",
      watchFile: (_path, onChange) => {
        watchReady.resolve(onChange)
        return () => {
          stopped = true
        }
      },
      readOutput: async () => ({
        source: "history",
        history: {
          sessionId: "s1",
          messages: [{ role: "assistant", blocks: [{ type: "text", text: "Streamed" }] }],
          firstIndex: 3,
        },
        cursor: "c4",
      }),
    })

    const received: TranscriptUpdatePush[] = []
    const unsub = feed.subscribe({ taskId: "T1", cursor: "c3" }, (u) => received.push(u))
    const triggerWatch = await watchReady.promise

    triggerWatch()
    await waitUntil(() => received.length === 1)
    expect(received[0]?.cursor).toBe("c4")

    unsub()
    expect(stopped).toBe(true)
    expect(feed.watchedCount).toBe(0)
  })

  test("recovers from SOURCE_CHANGED with a reset push", async () => {
    let calls = 0
    const feed = new TranscriptFeed({
      debounceMs: 0,
      readOutput: async ({ cursor }) => {
        calls++
        if (cursor === "stale") throw new BridgeError("SOURCE_CHANGED", "session rotated")
        return {
          source: "history",
          history: {
            sessionId: "s2",
            messages: [{ role: "user", blocks: [{ type: "text", text: "Fresh" }] }],
            firstIndex: 0,
          },
          cursor: "fresh-1",
          olderCursor: null,
        }
      },
    })

    const received: TranscriptUpdatePush[] = []
    const unsub = feed.subscribe({ taskId: "T1", cursor: "stale" }, (u) => received.push(u))
    feed.poke("T1")
    await waitUntil(() => received.length === 1)
    expect(calls).toBe(2)
    expect(received[0]?.reset).toBe(true)
    expect(received[0]?.cursor).toBe("fresh-1")
    unsub()
  })
})

describe("bridge transcript.subscribe / unsubscribe over WebSocket", () => {
  test("streams transcript.update pushes and cleans up on unsubscribe and disconnect", async () => {
    const transcripts = new TranscriptFeed({
      debounceMs: 0,
      readOutput: async () => ({
        source: "history",
        history: {
          sessionId: "s1",
          messages: [{ role: "assistant", blocks: [{ type: "text", text: "Live!" }] }],
          firstIndex: 1,
        },
        cursor: "c2",
      }),
    })

    const h = start({
      transcripts,
      areaOps: {
        "tab.send": {
          kind: "write",
          destructive: false,
          wraps: "test",
          async run() {
            return { delivered: true }
          },
        },
      },
    })
    const client = await connect(h.url, AUTH)

    const sub = await client.call("transcript.subscribe", { taskId: "T1", cursor: "c1" })
    expect(sub.ok).toBe(true)
    expect(sub.result).toEqual({ streaming: true })
    expect(transcripts.watchedCount).toBe(1)

    // Calling tab.send pokes the transcript feed and pushes an update over the socket.
    const sent = await client.call("tab.send", { taskId: "T1", prompt: "hello" })
    expect(sent.ok).toBe(true)
    await waitUntil(() => client.pushes.some((p) => p.event === "transcript.update"))
    const update = client.pushes.find((p) => p.event === "transcript.update")
    expect((update?.data as TranscriptUpdatePush).cursor).toBe("c2")

    const unsub = await client.call("transcript.unsubscribe", { taskId: "T1" })
    expect(unsub.ok).toBe(true)
    expect(transcripts.watchedCount).toBe(0)

    // Re-subscribe and verify socket close also tears down watchers.
    await client.call("transcript.subscribe", { taskId: "T1", cursor: "c2" })
    expect(transcripts.watchedCount).toBe(1)
    client.ws.close()
    await waitUntil(() => transcripts.watchedCount === 0)
    expect(transcripts.watchedCount).toBe(0)
  })
})
