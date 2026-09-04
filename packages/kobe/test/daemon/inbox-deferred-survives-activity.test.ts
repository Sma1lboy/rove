/**
 * A `prompt_deferred` episode is the ONLY pointer to a stored deferred prompt,
 * so engine activity must not evict it.
 *
 * The inbox keeps one episode per task+tab and every write starts by deleting
 * that key — the dedupe rule that keeps a queue of stale turn-completes from
 * piling up. `prompt_deferred` does not belong to that family: the daemon is
 * holding a human's message and the episode is how a human reaches it. When
 * the target agent simply carries on (a `turn-start`, then a `turn-complete`),
 * sharing the lane drops the episode and orphans the record in
 * `deferred-prompts.json` — retained for its 24h TTL, reachable from nowhere,
 * with `attention-inbox.json` holding `items: []`.
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AttentionInboxStore } from "@sma1lboy/kobe-daemon/daemon/attention-inbox"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import { afterEach, describe, expect, it } from "vitest"

describe("a deferred prompt's episode outlives the target's own activity", () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  async function store() {
    dir = await mkdtemp(join(tmpdir(), "kobe-inbox-deferred-"))
    const s = new AttentionInboxStore(join(dir, "attention-inbox.json"), new DaemonEventBus())
    await s.init()
    return s
  }

  it("survives the target starting a new turn", async () => {
    const s = await store()
    await s.recordPromptDeferred("t1", "tab-1", "d1", "composer-not-empty")
    // The agent carries on with whatever it was doing. That says nothing about
    // the message waiting for a human.
    await s.record("t1", "turn-start", undefined, "tab-1")
    expect(s.snapshot().map((e) => e.state)).toEqual(["prompt_deferred"])
  })

  it("survives the target completing a turn", async () => {
    const s = await store()
    await s.recordPromptDeferred("t1", "tab-1", "d1", "composer-not-empty")
    await s.record("t1", "turn-complete", undefined, "tab-1")
    // Both are real: one says the agent finished, the other that a message is
    // held. Losing the second loses a human's text.
    const states = s.snapshot().map((e) => e.state)
    expect(states).toContain("prompt_deferred")
  })

  it("still lets a NEWER deferral replace the older one for the same tab", async () => {
    // The dedupe rule is right for two deferrals — the store itself keeps one
    // prompt per tab, so two episodes would point at one record.
    const s = await store()
    await s.recordPromptDeferred("t1", "tab-1", "d1", "composer-not-empty")
    await s.recordPromptDeferred("t1", "tab-1", "d2", "recent-human-write")
    const deferred = s.snapshot().filter((e) => e.state === "prompt_deferred")
    expect(deferred).toHaveLength(1)
    expect(deferred[0]?.detail?.deferredPrompt?.id).toBe("d2")
  })

  it("is still removable by the release path", async () => {
    // Surviving activity must not make it unclearable — the Inbox's open
    // action resolves the record and deletes the episode.
    const s = await store()
    await s.recordPromptDeferred("t1", "tab-1", "d1", "composer-not-empty")
    await s.record("t1", "turn-complete", undefined, "tab-1")
    expect(await s.deleteEpisode("t1", "tab-1")).toBe(true)
    expect(s.snapshot().filter((e) => e.state === "prompt_deferred")).toEqual([])
  })
})
