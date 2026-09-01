/**
 * The send/paste split behind the workspace's engine handoffs
 * (use-tab-handoffs.ts). `sendToEngine` pastes AND submits (Create PR, the
 * diff-review notes); `pasteToEngine` pastes only — the FileTree `a` @path
 * mention lands in the engine's composer so the user keeps typing around it
 * (docs/TUI.md). A mention that submitted would fire a turn the user never
 * asked for, so the missing `\r` IS the contract.
 *
 * Drives the builders against a fake PTY registered under the tab's key; the
 * real bracketed-paste behaviour lives in the pty backends.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { buildEnginePaste, buildEngineSend } from "../../src/tui-react/workspace/use-tab-handoffs"
import { _resetDefaultPtyRegistry, getDefaultPtyRegistry } from "../../src/tui/panes/terminal/registry"

type Op = { readonly op: "paste" | "write"; readonly text: string }

function harness() {
  const ops: Op[] = []
  const fakePty = {
    killed: false,
    paste: (text: string) => void ops.push({ op: "paste", text }),
    write: (text: string) => void ops.push({ op: "write", text }),
  }
  const io = {
    stateRef: { current: { activeId: "tab-1", tabs: [{ id: "tab-1", kind: "engine" }] } },
    propsRef: { current: { taskId: "T1", worktree: "/wt/a" } },
    engineTabSpawnRef: { current: () => ({}) },
  } as never
  // The registry is the seam both builders resolve the PTY through.
  const reg = getDefaultPtyRegistry() as unknown as { get: (k: string) => unknown }
  const realGet = reg.get.bind(reg)
  reg.get = (key: string) => (key === "T1::tab-1" ? fakePty : realGet(key))
  return { ops, io }
}

afterEach(() => {
  _resetDefaultPtyRegistry()
})

describe("engine send vs paste", () => {
  test("sendToEngine pastes then submits with a carriage return", () => {
    const { ops, io } = harness()
    buildEngineSend(io)("PR PROMPT")
    expect(ops).toEqual([
      { op: "paste", text: "PR PROMPT" },
      { op: "write", text: "\r" },
    ])
  })

  test("pasteToEngine pastes WITHOUT submitting — the mention stays in the composer", () => {
    const { ops, io } = harness()
    buildEnginePaste(io)("@src/a.ts")
    expect(ops).toEqual([{ op: "paste", text: "@src/a.ts" }])
    expect(ops.some((o) => o.op === "write")).toBe(false)
  })
})
