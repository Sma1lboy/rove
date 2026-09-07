import { describe, expect, it } from "vitest"
import {
  type HistoryDeps,
  findLatestRolloutForWorktree,
  findRolloutFile,
  listSessionIdsForWorktree,
} from "../../src/engine/codex-local/history"
import { MAX_JSONL_LINE_CHARS } from "../../src/engine/file-bounds"
import { CodexTurnDetector, latestCodexCompletionMarkerFromJsonl } from "../../src/engine/turn-detector"

function store(count: number) {
  const id = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`
  const names = Array.from({ length: count }, (_, n) => `rollout-2026-01-01T00-00-00-${id(n)}.jsonl`)
  const deps: HistoryDeps = {
    sessionsDir: () => "/sessions",
    readdir: async (p) => {
      if (p === "/sessions") return ["2026"]
      if (p === "/sessions/2026") return ["01"]
      if (p === "/sessions/2026/01") return ["01"]
      if (p === "/sessions/2026/01/01") return names
      return []
    },
    readFile: async (p) =>
      JSON.stringify({ type: "session_meta", payload: { cwd: p.endsWith(`${id(0)}.jsonl`) ? "/target" : "/other" } }),
    stat: async () => ({ mtimeMs: 100 }),
  }
  return { deps, targetId: id(0) }
}

describe("complete Codex discovery", () => {
  it("finds activity in the thirteenth rollout", async () => {
    const { deps, targetId } = store(13)
    expect((await findLatestRolloutForWorktree("/target", deps))?.path).toContain(targetId)
  })
  it("lists a worktree session beyond two hundred unrelated rollouts", async () => {
    const { deps, targetId } = store(201)
    expect(await listSessionIdsForWorktree("/target", deps)).toEqual([targetId])
  })
  it("locates a full UUID beyond five thousand rollouts", async () => {
    const { deps, targetId } = store(5001)
    expect(await findRolloutFile(targetId, deps)).toContain(targetId)
  })
})

it("reads the reporting Codex session without a sibling worktree lookup", async () => {
  const detector = new CodexTurnDetector({
    findLatestRollout: async () => {
      throw new Error("must not discover a sibling")
    },
    readFile: async () => '{"type":"event_msg","payload":{"type":"task_started"}}',
    statMtimeMs: async () => 100,
  })
  expect(await detector.latestActivityInFile("/session-a.jsonl")).toEqual({ marker: null, mtimeMs: 100 })
})

it("skips a completion record beyond the JSONL line bound", () => {
  const raw = JSON.stringify({ type: "turn.completed", padding: "x".repeat(MAX_JSONL_LINE_CHARS) })
  expect(latestCodexCompletionMarkerFromJsonl(raw)).toBeNull()
})
