/**
 * Characterization of a tab's RESUME argv, written before the engine-owned
 * session contract landed so the claude/codex shapes are pinned against
 * regression rather than re-derived from the implementation afterwards.
 *
 * The gap this file exists to expose: only claude ever had a session id to
 * resume from (`--session-id` pinned at spawn), so `engineTabArgv`'s
 * `--resume` was unreachable for every other engine — and hard-coded to
 * claude's flag if it ever were reached.
 */

import { type EngineTab, engineTabArgv } from "@/tui/workspace/terminal-tabs-core"
import { describe, expect, it } from "vitest"

const tab = (over: Partial<EngineTab>): EngineTab => ({
  kind: "engine",
  id: "tab-1",
  title: null,
  ordinal: 1,
  ...over,
})

describe("engineTabArgv session flags", () => {
  it("pins claude's session on a fresh spawn and resumes it when the PTY died", () => {
    const t = tab({ vendor: "claude", sessionId: "u1" })
    expect(engineTabArgv(t, ["claude"], false)).toEqual(["claude", "--session-id", "u1"])
    expect(engineTabArgv(t, ["claude"], true)).toEqual(["claude", "--session-id", "u1"])
    expect(engineTabArgv({ ...t, spawned: true }, ["claude"], false)).toEqual(["claude", "--resume", "u1"])
    // A live PTY is re-render churn, not a restart — never a resume.
    expect(engineTabArgv({ ...t, spawned: true }, ["claude"], true)).toEqual(["claude", "--session-id", "u1"])
  })

  it("leaves a tab with no session id on the bare command", () => {
    expect(engineTabArgv(tab({ vendor: "kimi" }), ["kimi"], false)).toEqual(["kimi"])
    expect(engineTabArgv(tab({ vendor: "kimi", spawned: true }), ["kimi"], false)).toEqual(["kimi"])
  })
})
