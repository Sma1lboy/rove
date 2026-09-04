/** @jsxImportSource @opentui/react */
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
 *
 * Both also ANSWER: false means the write went nowhere. They used to return
 * undefined either way, so the diff review marked its notes sent against a
 * task with no engine session and the FileTree mention reported nothing —
 * the callers cannot surface what the closure will not tell them.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { buildEnginePaste, buildEngineSend, useTabHandoffs } from "../../src/tui-react/workspace/use-tab-handoffs"
import { _resetDefaultPtyRegistry, getDefaultPtyRegistry } from "../../src/tui/panes/terminal/registry"
import { renderComponent } from "./harness"

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

  test("a delivered write answers true", () => {
    const { io } = harness()
    expect(buildEngineSend(io)("PR PROMPT")).toBe(true)
    expect(buildEnginePaste(io)("@src/a.ts")).toBe(true)
  })

  test("both answer false when the task has no engine tab — `ctrl+w` on the last one", () => {
    const { ops, io } = harness()
    const state = io as unknown as { stateRef: { current: { activeId: string; tabs: unknown[] } } }
    state.stateRef.current = { activeId: "tab-2", tabs: [{ id: "tab-2", kind: "command" }] }
    expect(buildEngineSend(io)("PR PROMPT")).toBe(false)
    expect(buildEnginePaste(io)("@src/a.ts")).toBe(false)
    expect(ops).toEqual([])
  })

  test("both answer false when the engine PTY is dead", () => {
    const { ops, io } = harness()
    const reg = getDefaultPtyRegistry() as unknown as { get: (k: string) => { killed: boolean } }
    const pty = reg.get("T1::tab-1")
    pty.killed = true
    expect(buildEngineSend(io)("PR PROMPT")).toBe(false)
    expect(buildEnginePaste(io)("@src/a.ts")).toBe(false)
    expect(ops).toEqual([])
  })
})

/**
 * The hook that hands those closures up. Its four effects are mount-once, so
 * "the parent got a live closure" is only observable by mounting it — and the
 * closure the parent stores is the one whose answer everything above now
 * depends on.
 */
describe("useTabHandoffs", () => {
  test("hands the parent an engine send/paste pair that reports delivery", async () => {
    const { ops, io } = harness()
    const handed: { send?: (text: string) => boolean; paste?: (text: string) => boolean } = {}
    let openedEditor = false
    let openedDiff = false
    const props = {
      taskId: "T1",
      worktree: "/wt/a",
      onEngineSendReady: (fn: (text: string) => boolean) => {
        handed.send = fn
      },
      onEnginePasteReady: (fn: (text: string) => boolean) => {
        handed.paste = fn
      },
      onEditorTabReady: () => {
        openedEditor = true
      },
      onDiffTabReady: () => {
        openedDiff = true
      },
    }
    const full = {
      ...(io as object),
      propsRef: { current: props },
      update: () => {},
      bumpResetToken: () => {},
    } as never

    function Host() {
      useTabHandoffs(full)
      return <text>handoffs</text>
    }
    await renderComponent(<Host />, { width: 30, height: 4 })

    expect(openedEditor).toBe(true)
    expect(openedDiff).toBe(true)
    expect(handed.send?.("PROMPT")).toBe(true)
    expect(handed.paste?.("@a.ts")).toBe(true)
    expect(ops).toEqual([
      { op: "paste", text: "PROMPT" },
      { op: "write", text: "\r" },
      { op: "paste", text: "@a.ts" },
    ])
  })
})
