/** @jsxImportSource @opentui/react */
/**
 * The sidebar menu's "New conversation" / "New shell" as the TASK's workspace
 * sees it: `requestNewTab` → the mounted `useTabRequests` listener.
 *
 * The risky half is the one the sidebar can't see: a request aimed at a task
 * whose tabs are NOT mounted survives until they are (the sidebar activates
 * the task, so the tabs always mount a beat later).
 */

import { expect, test } from "bun:test"
import { requestNewTab } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { useTabRequests } from "../../src/tui-react/workspace/use-tab-requests"
import { type TabsState, initialTabs } from "../../src/tui/workspace/terminal-tabs-core"
import { act, renderComponent, settle } from "./harness"

/** Task ids are unique per TEST on purpose: the harness tears the RENDERER down
 *  but does not unmount React, so a probe's listener outlives its test — one
 *  registered for a shared id would claim a later test's (or another file's)
 *  request and write into the wrong recorder. */
function harnessFor(taskId: string) {
  const writes: TabsState[] = []
  const chats: number[] = []
  const shells: number[] = []
  const stateRef = { current: initialTabs() }
  const io = {
    stateRef,
    propsRef: { current: { taskId } },
    updateRef: {
      current: (next: TabsState) => {
        stateRef.current = next
        writes.push(next)
      },
    },
    tabCloseRef: { current: { closeById: () => {} } },
    activeLeafSizeRef: { current: () => null },
    openNewConversationRef: { current: () => chats.push(1) },
    openNewShellRef: { current: () => shells.push(1) },
  }
  const Probe = () => {
    useTabRequests(io)
    return <text>probe</text>
  }
  return { Probe, writes, chats, shells, stateRef }
}

test("'new conversation' runs the task's ctrl+t new-conversation action", async () => {
  const { Probe, chats, writes } = harnessFor("newtab-chat")
  await renderComponent(<Probe />, { width: 20, height: 4 })
  await settle()

  await act(async () => {
    requestNewTab("newtab-chat", "chat")
  })

  expect(chats.length).toBe(1)
  // The action owns what lands (a child task); the tab state itself is untouched.
  expect(writes.length).toBe(0)
})

test("'new shell' runs the task's new-shell action and leaves its own tabs alone", async () => {
  const { Probe, writes, chats, shells } = harnessFor("newtab-shell")
  await renderComponent(<Probe />, { width: 20, height: 4 })
  await settle()

  await act(async () => {
    requestNewTab("newtab-shell", "shell")
  })

  expect(chats.length).toBe(0)
  // The action owns what lands (a child task whose tab-1 is the shell); this task gains no tab.
  expect(shells.length).toBe(1)
  expect(writes.length).toBe(0)
})

test("a request for a task whose tabs aren't mounted waits for that mount", async () => {
  // What the sidebar actually does on a background worktree: ask, then let the
  // host's activation mount the workspace that claims it.
  const { Probe, chats } = harnessFor("newtab-cold")
  await act(async () => {
    requestNewTab("newtab-cold", "chat")
  })
  expect(chats.length).toBe(0)

  await renderComponent(<Probe />, { width: 20, height: 4 })
  await settle()

  expect(chats.length).toBe(1)
})
