/**
 * Client side of the `transcript.activity` channel (perf — deduplicate
 * per-Ops-pane polling). Mirrors the `worktree.changes` coverage:
 *
 *   - The equality helper `sameTranscriptActivityMap` gates re-renders.
 *   - The `RemoteOrchestrator` parses a push into the map. The shared map-channel
 *     rule (wholesale replace, same ref on replay, log+drop garbage) is pinned
 *     once on `worktree.changes` in remote-orchestrator.test.ts.
 *   - Capability gating in `init()`: a capable daemon seeds an EMPTY map
 *     (trust pushes → the Ops pane stops local polling), an old daemon leaves
 *     the signal null (the pane's local mtime/completion probes engage).
 */

import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { describe, expect, it } from "vitest"
import { sameTranscriptActivityMap } from "../../src/client/remote-orchestrator-payloads.ts"
import { RemoteOrchestrator } from "../../src/client/remote-orchestrator.ts"

function fakeClient(): { client: RoveDaemonClient; emit: (name: string, payload: unknown) => void } {
  let star: ((frame: { name: string; payload: unknown }) => void) | undefined
  const client = {
    on: (name: string, handler: (frame: { name: string; payload: unknown }) => void) => {
      if (name === "*") star = handler
      return () => {}
    },
    onLifecycle: () => () => {},
  } as unknown as RoveDaemonClient
  return { client, emit: (name, payload) => star?.({ name, payload }) }
}

function fakeRpcClient(hello: Record<string, unknown>) {
  let star: ((frame: { name: string; payload: unknown }) => void) | undefined
  const client = {
    on: (name: string, handler: (frame: { name: string; payload: unknown }) => void) => {
      if (name === "*") star = handler
      return () => {}
    },
    onLifecycle: () => () => {},
    request: async (name: string) => (name === "hello" ? hello : {}),
    subscribe: async () => ({}),
  } as unknown as RoveDaemonClient
  return { client, emit: (name: string, payload: unknown) => star?.({ name, payload }) }
}

const e = (mtimeMs: number, completionId: string | null = null, completionAt = 0) => ({
  mtimeMs,
  completionId,
  completionAt,
})

describe("transcript.activity pure helpers", () => {
  it("sameTranscriptActivityMap compares entry-wise", () => {
    const a = new Map([["/wt", e(5, "c1", 9)]])
    expect(sameTranscriptActivityMap(a, new Map([["/wt", e(5, "c1", 9)]]))).toBe(true)
    expect(sameTranscriptActivityMap(a, new Map([["/wt", e(6, "c1", 9)]]))).toBe(false)
    expect(sameTranscriptActivityMap(a, new Map([["/wt", e(5, "c2", 9)]]))).toBe(false)
    expect(sameTranscriptActivityMap(a, new Map())).toBe(false)
  })
})

describe("RemoteOrchestrator transcript.activity channel", () => {
  it("reflects a pushed transcript.activity map and replaces it wholesale", () => {
    const { client, emit } = fakeClient()
    const orch = new RemoteOrchestrator(client)
    emit("transcript.activity", { activity: { "/wt/a": e(2, "c", 1), "/wt/b": e(0) } })
    const first = orch.transcriptActivitySignal()()
    expect(first?.get("/wt/a")).toEqual({ mtimeMs: 2, completionId: "c", completionAt: 1 })
    expect(first?.size).toBe(2)

    emit("transcript.activity", { activity: { "/wt/a": e(2, "c", 1) } })
    const second = orch.transcriptActivitySignal()()
    expect(second?.size).toBe(1)
    expect(second?.has("/wt/b")).toBe(false)
  })
})

describe("transcript.activity capability gating (init)", () => {
  it("a transcript.activity-capable daemon yields an empty map before any publish", async () => {
    const { client } = fakeRpcClient({ protocolVersion: 3, capabilities: ["task.snapshot", "transcript.activity"] })
    const orch = new RemoteOrchestrator(client)
    await orch.init()
    expect(orch.transcriptActivitySignal()()?.size).toBe(0)
  })

  it("a capability-less (old) daemon resets the signal to null — local fallback engages", async () => {
    const { client, emit } = fakeRpcClient({ protocolVersion: 3, capabilities: ["task.snapshot"] })
    const orch = new RemoteOrchestrator(client)
    emit("transcript.activity", { activity: { "/wt/a": e(1, "c", 1) } })
    await orch.init()
    expect(orch.transcriptActivitySignal()()).toBeNull()
  })

  it("a replayed transcript.activity map delivered during subscribe survives init", async () => {
    const { client, emit } = fakeRpcClient({ protocolVersion: 3, capabilities: ["transcript.activity"] })
    const orch = new RemoteOrchestrator(client)
    emit("transcript.activity", { activity: { "/wt/a": e(4, "c4", 2) } })
    await orch.init()
    expect(orch.transcriptActivitySignal()()?.get("/wt/a")).toEqual({ mtimeMs: 4, completionId: "c4", completionAt: 2 })
  })
})
