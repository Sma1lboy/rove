/** @jsxImportSource @opentui/react */
/** Clicking a toast that names a task opens it; an action toast (no task) only dismisses. */

import { expect, it } from "bun:test"
import { useEffect, useRef } from "react"
import { ToastOverlay } from "../../src/tui-react/component/toast-overlay"
import { useNotifications } from "../../src/tui-react/context/notifications"
import { act, renderComponent } from "./harness"

function Harness({
  taskId,
  onOpenTask,
}: { taskId: string; onOpenTask: (taskId: string, tabId: string | null) => void }) {
  const notif = useNotifications()
  const pushed = useRef(false)
  useEffect(() => {
    if (pushed.current) return
    pushed.current = true
    notif.notify({ kind: "done", taskId, tabId: taskId ? "tab-2" : "", title: "Fix the lamp" })
  }, [notif, taskId])
  return <ToastOverlay onOpenTask={onOpenTask} />
}

async function clickToast(taskId: string): Promise<{ opened: [string, string | null][]; after: string }> {
  const opened: [string, string | null][] = []
  const { frame, mockMouse } = await renderComponent(
    <Harness taskId={taskId} onOpenTask={(id, tab) => opened.push([id, tab])} />,
    { width: 60, height: 12, providers: { notifications: true } },
  )
  await act(async () => {})
  const row = (await frame()).split("\n").findIndex((line) => line.includes("Fix the lamp"))
  expect(row).toBeGreaterThanOrEqual(0)
  await act(async () => {
    await mockMouse.click(30, row)
  })
  return { opened, after: await frame() }
}

it("opens the task and tab a finished-turn toast names", async () => {
  const { opened, after } = await clickToast("t1")
  expect(opened).toEqual([["t1", "tab-2"]])
  expect(after).not.toContain("Fix the lamp")
})

it("only dismisses a toast with no task", async () => {
  const { opened, after } = await clickToast("")
  expect(opened).toEqual([])
  expect(after).not.toContain("Fix the lamp")
})
