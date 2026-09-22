/**
 * `pty-delivery.ts`'s engine-key RESOLVER — the pure half, split from the
 * delivery tests in `pty-delivery.test.ts` to stay under the file-size cap.
 *
 * The load-bearing bit is `findEngineKey`: it MUST resolve the engine tab
 * (never a shell tab) and MUST return null when a task has no engine — that
 * null is what stops delivery from double-opening a second engine in the
 * same worktree.
 */

import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import { describe, expect, it } from "vitest"
import { findEngineKey, isTaskKey, taskKeys } from "../../src/cli/api/pty-delivery.ts"

function session(key: string, command: string[], alive = true): PtySessionInfo {
  return { key, alive, pid: alive ? 123 : null, command, title: "" }
}

describe("findEngineKey", () => {
  it("② with tab-1 engine + tab-2 shell, picks tab-1 (never the shell)", () => {
    const sessions = [session("t1::tab-1", ["claude"]), session("t1::tab-2", ["/bin/zsh"])]
    expect(findEngineKey(sessions, "t1", "claude")).toBe("t1::tab-1")
  })

  it("③ no engine tab → null (caller must NOT double-open)", () => {
    // Only a shell tab, and tab-1 absent: there is no engine to deliver into.
    const sessions = [session("t1::tab-2", ["/bin/zsh"])]
    expect(findEngineKey(sessions, "t1", "claude")).toBeNull()
  })

  it("resolves a SHELL-WRAPPED engine tab when tab-1 is absent", () => {
    // Every hosted session launches via `<shell> -ilc '…<engine> …'`
    // (buildEngineSessionLaunch), so command[0] is NEVER the engine binary.
    // The old `command[0] === engineBin` fallback was dead code in
    // production: this surviving engine tab resolved to null and delivery
    // silently spawned a duplicate engine.
    const sessions = [
      session("t1::tab-1", ["/bin/zsh", "-ilc", "export KOBE_TASK_ID='t1'\nclaude 'hi'"], false),
      session("t1::tab-2", ["/bin/zsh", "-ilc", "export KOBE_TASK_ID='t1' KOBE_TAB_ID='tab-2'\nclaude '--resume' 'x'"]),
    ]
    expect(findEngineKey(sessions, "t1", "claude")).toBe("t1::tab-2")
  })

  it("skips a DEAD tab-1 (an exited engine cannot receive a prompt)", () => {
    const sessions = [session("t1::tab-1", ["claude"], false)]
    expect(findEngineKey(sessions, "t1", "claude")).toBeNull()
  })

  it("without engineBin, still resolves tab-1 (liveness/teardown path)", () => {
    const sessions = [session("t1::tab-1", ["claude"])]
    expect(findEngineKey(sessions, "t1")).toBe("t1::tab-1")
  })

  it("resolves a live engine tab whose binary is NOT the task's vendor", () => {
    // The reported shape: a long-lived task pinned to the custom preset
    // `claudecpa` (a zsh wrapper) whose tab-1 is long gone and whose only
    // live tabs launch plain `claude`. engineBin is `claudecpa`, so the
    // vendor-strict argv match found nothing and bare send refused with
    // NO_ENGINE_TAB — while the delivery gate accepts ANY live engine.
    const sessions = [
      session("t1::tab-22", ["/bin/zsh", "-ilc", "export KOBE_TAB_ID='tab-22'\nclaude --session-id bf09"]),
    ]
    expect(findEngineKey(sessions, "t1", "claudecpa")).toBe("t1::tab-22")
  })

  it("prefers the task's OWN vendor tab over another engine's tab", () => {
    const sessions = [
      session("t1::tab-3", ["/bin/zsh", "-ilc", "codex"]),
      session("t1::tab-9", ["/bin/zsh", "-ilc", "claude"]),
    ]
    expect(findEngineKey(sessions, "t1", "claude")).toBe("t1::tab-9")
  })

  it("picks the LOWEST-numbered engine tab so a bare send is deterministic", () => {
    const sessions = [
      session("t1::tab-28", ["/bin/zsh", "-ilc", "claude"]),
      session("t1::tab-22", ["/bin/zsh", "-ilc", "claude"]),
    ]
    expect(findEngineKey(sessions, "t1", "claudecpa")).toBe("t1::tab-22")
  })

  it("a live SHELL-only tab is still not an engine (no cross-vendor false positive)", () => {
    const sessions = [session("t1::tab-4", ["/bin/zsh", "-il"])]
    expect(findEngineKey(sessions, "t1", "claudecpa")).toBeNull()
  })
})

describe("isTaskKey / taskKeys", () => {
  it("matches the segment before the first ::", () => {
    expect(isTaskKey("t1::tab-1", "t1")).toBe(true)
    expect(isTaskKey("t1", "t1")).toBe(true)
    expect(isTaskKey("t10::tab-1", "t1")).toBe(false)
  })

  it("taskKeys returns every key for the task (alive or not — teardown)", () => {
    const sessions = [
      session("t1::tab-1", ["claude"]),
      session("t1::tab-2", ["/bin/zsh"], false),
      session("t2::tab-1", ["claude"]),
    ]
    expect(taskKeys(sessions, "t1")).toEqual(["t1::tab-1", "t1::tab-2"])
  })
})
