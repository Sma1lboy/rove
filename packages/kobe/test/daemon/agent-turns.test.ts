/** Durable per-turn telemetry: store persistence + the hook-driven ingest. */

import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { daemonRuntime } from "@/core/daemon-runtime"
import { ingestAgentTurns } from "@sma1lboy/kobe-daemon/daemon/agent-turns-ingest"
import { AgentTurnsStore } from "@sma1lboy/kobe-daemon/daemon/agent-turns-store"
import type { AgentTurn, AgentTurnRecord, DaemonOrchestrator } from "@sma1lboy/kobe-daemon/daemon/contracts"
import type { DaemonRuntimeAdapter } from "@sma1lboy/kobe-daemon/daemon/runtime"
import { afterEach, describe, expect, it } from "vitest"

let dir: string | null = null

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = null
})

async function createStore(): Promise<{ store: AgentTurnsStore; path: string }> {
  dir = await mkdtemp(join(tmpdir(), "kobe-agent-turns-"))
  const path = join(dir, "agent-turns.json")
  const store = new AgentTurnsStore(path)
  await store.init()
  return { store, path }
}

function record(over: Partial<AgentTurnRecord> = {}): AgentTurnRecord {
  return {
    id: "msg_a",
    taskId: "task-1",
    vendor: "claude",
    model: "claude-opus-5",
    repo: "/repo",
    startedAt: 1000,
    endedAt: 2000,
    usage: { input_tokens: 1, output_tokens: 2 },
    ...over,
  }
}

describe("AgentTurnsStore", () => {
  it("persists turns and reloads them", async () => {
    const { store, path } = await createStore()
    expect(await store.record([record()])).toBe(1)

    const reloaded = new AgentTurnsStore(path)
    await reloaded.init()
    expect(reloaded.list()).toEqual([record()])
  })

  it("dedupes a re-read of the same turn (the every-Stop re-scan)", async () => {
    const { store } = await createStore()
    expect(await store.record([record()])).toBe(1)
    expect(await store.record([record(), record({ id: "msg_b", endedAt: 3000 })])).toBe(1)
    expect(store.list().map((t) => t.id)).toEqual(["msg_b", "msg_a"]) // newest first
  })

  it("persists a field-only re-read of an existing turn (last write wins, durably)", async () => {
    const { store, path } = await createStore()
    expect(await store.record([record({ usage: { input_tokens: 1, output_tokens: 2 } })])).toBe(1)
    // A later Stop re-reads the same turn with a more complete usage. No NEW
    // turn, so record() still reports 0 — but the update must reach disk.
    const fuller = record({ usage: { input_tokens: 1, output_tokens: 99 }, endedAt: 2500 })
    expect(await store.record([fuller])).toBe(0)
    expect(store.list()[0].usage?.output_tokens).toBe(99)

    const reloaded = new AgentTurnsStore(path)
    await reloaded.init()
    expect(reloaded.list()).toEqual([fuller])
  })

  it("skips the write when a re-read is byte-identical (the common no-op Stop)", async () => {
    const { store, path } = await createStore()
    await store.record([record()])
    const before = await stat(path)
    expect(await store.record([record()])).toBe(0)
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs) // untouched
  })

  it("scopes the dedupe key by task, so two tasks may carry the same engine id", async () => {
    const { store } = await createStore()
    await store.record([record(), record({ taskId: "task-2" })])
    expect(store.list()).toHaveLength(2)
  })

  it("filters by task, repo, and since; drops malformed rows", async () => {
    const { store } = await createStore()
    await store.record([
      record(),
      record({ id: "msg_b", taskId: "task-2", repo: "/other", endedAt: 9000 }),
      { id: "", taskId: "task-3", startedAt: 1, endedAt: 2 } as AgentTurnRecord,
    ])
    expect(store.list({ taskId: "task-2" }).map((t) => t.id)).toEqual(["msg_b"])
    expect(store.list({ repo: "/repo" }).map((t) => t.id)).toEqual(["msg_a"])
    expect(store.list({ since: 5000 }).map((t) => t.id)).toEqual(["msg_b"])
    expect(store.list({ limit: 1 })).toHaveLength(1)
    expect(store.list().some((t) => t.taskId === "task-3")).toBe(false)
  })

  it("drops a deleted task's turns", async () => {
    const { store } = await createStore()
    await store.record([record(), record({ taskId: "task-2" })])
    await store.deleteTask("task-1")
    expect(store.list().map((t) => t.taskId)).toEqual(["task-2"])
  })
})

describe("ingestAgentTurns", () => {
  const engineTurn: AgentTurn = {
    id: "msg_a",
    sessionId: "sess-1",
    model: "claude-opus-5",
    startedAt: 1000,
    endedAt: 2000,
    usage: { input_tokens: 1, output_tokens: 2 },
  }

  function deps(turns: readonly AgentTurn[] = [engineTurn], task: unknown = { repo: "/repo", vendor: "claude" }) {
    const asked: { vendor: string; path: string }[] = []
    const runtime = {
      readEngineTurns: async (vendor: string, path: string) => {
        asked.push({ vendor, path })
        return turns
      },
    } as unknown as DaemonRuntimeAdapter
    const orch = { getTask: () => task } as unknown as DaemonOrchestrator
    return { runtime, orch, asked }
  }

  it("joins engine turns to task identity and records them", async () => {
    const { store } = await createStore()
    const { runtime, orch, asked } = deps()

    const result = await ingestAgentTurns(store, runtime, orch, {
      taskId: "task-1",
      tabId: "tab-2",
      vendor: "claude",
      transcriptPath: "/t.jsonl",
    })
    expect(result.recorded).toBe(1)
    expect(result.latest).toMatchObject({ id: engineTurn.id })
    expect(asked).toEqual([{ vendor: "claude", path: "/t.jsonl" }])
    expect(store.list()).toEqual([{ ...engineTurn, taskId: "task-1", tabId: "tab-2", vendor: "claude", repo: "/repo" }])
  })

  it("no transcript path and no resolvable vendor are both no-ops", async () => {
    const { store } = await createStore()
    const { runtime, orch, asked } = deps()
    expect((await ingestAgentTurns(store, runtime, orch, { taskId: "task-1" })).recorded).toBe(0)

    const vendorless = deps(undefined, { repo: "/repo" })
    expect(
      (
        await ingestAgentTurns(store, vendorless.runtime, vendorless.orch, {
          taskId: "task-1",
          transcriptPath: "/t.jsonl",
        })
      ).recorded,
    ).toBe(0)
    expect(asked).toEqual([])
    expect(store.list()).toEqual([])
  })

  it("falls back to the task's vendor when the hook carried no --engine tag", async () => {
    const { store } = await createStore()
    const { runtime, orch, asked } = deps()
    await ingestAgentTurns(store, runtime, orch, { taskId: "task-1", transcriptPath: "/t.jsonl" })
    expect(asked[0].vendor).toBe("claude")
  })

  // The whole join, with NO stubbed reader: real runtime adapter -> real
  // registry lookup -> the vendor's own parser. This is what tells an
  // `agent-turns` page that is honestly empty apart from one that is empty
  // because the engine has no reader — with codex's `readTurns` unregistered
  // this records 0 and the assertions below fail.
  it("records codex turns through the real runtime adapter", async () => {
    const { store } = await createStore()
    const rollout = join(dir as string, "rollout.jsonl")
    const turnId = "01a060d6-dd1a-7621-889f-d9da35a4699e"
    await writeFile(
      rollout,
      [
        { timestamp: "2026-09-02T06:38:09.182Z", type: "session_meta", payload: { session_id: "sess-cx" } },
        {
          timestamp: "2026-09-02T06:38:09.182Z",
          type: "event_msg",
          payload: { type: "task_started", turn_id: turnId, model_context_window: 258400 },
        },
        {
          timestamp: "2026-09-02T06:38:09.398Z",
          type: "turn_context",
          payload: { turn_id: turnId, model: "gpt-5.6-luna" },
        },
        {
          timestamp: "2026-09-02T06:38:16.153Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: { input_tokens: 19292, cached_input_tokens: 8960, output_tokens: 276 },
              last_token_usage: { input_tokens: 19292, cached_input_tokens: 8960, output_tokens: 276 },
            },
          },
        },
        {
          timestamp: "2026-09-02T06:39:02.616Z",
          type: "event_msg",
          payload: { type: "task_complete", turn_id: turnId },
        },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n"),
    )
    const orch = { getTask: () => ({ repo: "/repo", vendor: "codex" }) } as unknown as DaemonOrchestrator

    const result = await ingestAgentTurns(store, daemonRuntime, orch, {
      taskId: "task-cx",
      vendor: "codex",
      transcriptPath: rollout,
    })

    expect(result.recorded).toBe(1)
    expect(store.list()).toEqual([
      {
        id: turnId,
        // Read off the rollout's `session_meta`, so the record names the codex
        // session it came from and not just the Rove task.
        sessionId: "sess-cx",
        taskId: "task-cx",
        vendor: "codex",
        model: "gpt-5.6-luna",
        repo: "/repo",
        startedAt: Date.parse("2026-09-02T06:38:09.182Z"),
        endedAt: Date.parse("2026-09-02T06:39:02.616Z"),
        usage: {
          input_tokens: 10332,
          output_tokens: 276,
          cache_read_input_tokens: 8960,
          context_window_tokens: 258400,
        },
      },
    ])
  })
})
