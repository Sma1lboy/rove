/** @jsxImportSource @opentui/react */
/** A muted task stops toasting while it keeps its unread dot; its failures still show, and other tasks are untouched. */
import { expect, test } from "bun:test"
import { MUTED_TASKS_KEY, toggleMutedTask } from "@sma1lboy/rove-core/lib/notify-state.ts"
import { useEffect } from "react"
import { ToastOverlay } from "../../src/tui-react/component/toast-overlay"
import { useKV } from "../../src/tui-react/context/kv"
import { useNotifications } from "../../src/tui-react/context/notifications"
import { isolateHome, renderComponent, settle } from "./harness"

isolateHome()

let unreadKeys: string[] = []

function Push() {
  const kv = useKV()
  const n = useNotifications()
  const muted = Array.isArray(kv.get(MUTED_TASKS_KEY))
  useEffect(() => {
    if (kv.ready && !muted) kv.update(MUTED_TASKS_KEY, (current) => toggleMutedTask(current, "noisy"))
  }, [kv, muted])
  useEffect(() => {
    if (!muted) return
    n.notify({ kind: "done", taskId: "noisy", tabId: "", title: "Noisy finished", turnEnd: true })
    n.notify({ kind: "needs_input", taskId: "noisy", tabId: "", title: "Noisy asks" })
    n.notify({ kind: "error", taskId: "noisy", tabId: "t2", title: "Noisy failed" })
    n.notify({ kind: "done", taskId: "quiet", tabId: "", title: "Quiet finished", turnEnd: true })
  }, [muted, n.notify])
  unreadKeys = [...n.unread.keys()]
  return null
}

test("a muted task shows only its error toast but still marks unread", async () => {
  const h = await renderComponent(
    <box flexDirection="column" width={80} height={24}>
      <Push />
      <ToastOverlay />
    </box>,
    { width: 80, height: 24, providers: { kv: true, notifications: true } },
  )
  await settle()
  const frame = await h.frame()
  expect(frame).not.toContain("Noisy finished")
  expect(frame).not.toContain("Noisy asks")
  expect(frame).toContain("Noisy failed")
  expect(frame).toContain("Quiet finished")
  expect(unreadKeys).toContain("noisy:")
  h.destroy()
})
