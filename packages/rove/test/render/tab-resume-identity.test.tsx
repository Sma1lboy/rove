/** @jsxImportSource @opentui/react */
import { afterEach, expect, spyOn, test } from "bun:test"
import { useState } from "react"
import { useTabTurnState } from "../../src/tui-react/workspace/use-tab-turn-state"
import { MockTaskPty } from "../../src/tui/panes/terminal/pty-mock"
import { getDefaultPtyRegistry } from "../../src/tui/panes/terminal/registry"
import { getDefaultLiveEngines } from "../../src/tui/workspace/live-engine"
import type { TabsState } from "../../src/tui/workspace/terminal-tabs-core"
import type { VendorId } from "../../src/types/vendor"
import { act, renderComponent } from "./harness"

const restore: (() => void)[] = []
afterEach(() => {
  for (const run of restore.splice(0)) run()
})

test("a restored tab keeps its session through shell startup and demotes only after a live engine exits", async () => {
  const pty = new MockTaskPty({ taskId: "resume::tab-1", cwd: "/wt" })
  pty.feed("\x1b]0;restored title\x07")
  const registry = getDefaultPtyRegistry()
  const get = spyOn(registry, "get").mockImplementation((key) => (key === pty.taskId ? pty : null))
  const has = spyOn(registry, "has").mockImplementation((key) => key === pty.taskId)
  let live: VendorId | null | undefined
  const listeners = new Set<() => void>()
  const engines = getDefaultLiveEngines()
  const resolve = spyOn(engines, "resolve").mockImplementation(() => live)
  const subscribe = spyOn(engines, "subscribe").mockImplementation((listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })
  restore.push(() => {
    get.mockRestore()
    has.mockRestore()
    resolve.mockRestore()
    subscribe.mockRestore()
  })
  let state: TabsState = {
    tabs: [
      { kind: "engine", id: "tab-1", ordinal: 1, title: null, spawned: true, sessionId: "saved", liveVendor: "claude" },
    ],
    activeId: "tab-1",
    nextOrdinal: 2,
  }
  function Probe() {
    const [current, update] = useState(state)
    state = current
    useTabTurnState({
      taskId: "resume",
      worktree: "/wt",
      vendor: "claude",
      state: current,
      update,
      notif: { toasts: [], unread: new Map(), notify() {}, dismiss() {}, markRead() {} },
    })
    return <text>resume</text>
  }
  const rendered = await renderComponent(<Probe />)
  const observe = async (vendor: VendorId | null | undefined) => {
    await act(async () => {
      live = vendor
      for (const listener of [...listeners]) listener()
    })
    await rendered.rerender()
  }
  await observe(null)
  expect(state.tabs[0]).toMatchObject({ kind: "engine", sessionId: "saved", spawned: true })
  await observe("claude")
  expect(state.tabs[0]?.kind).toBe("engine")
  await observe(null)
  expect(state.tabs[0]?.kind).toBe("command")
  rendered.destroy()
})
