/** @jsxImportSource @opentui/react */
/** The toast stack sits in its pane row whatever is above it, and a keyed outcome replaces its progress toast. */
import { expect, test } from "bun:test"
import { useEffect } from "react"
import { ToastOverlay } from "../../src/tui-react/component/toast-overlay"
import { NotificationsProvider, useNotifications } from "../../src/tui-react/context/notifications"
import { renderComponent } from "./harness"

function Push() {
  const n = useNotifications()
  useEffect(() => {
    n.notify({ kind: "done", taskId: "", tabId: "", title: "Creating task…", key: "create" })
    n.notify({
      kind: "error",
      taskId: "",
      tabId: "",
      title: "Task created; engine did not start",
      key: "create",
      hint: "ENGINE_LIMIT: the cap is 1. Press ⏎ on the task to retry.",
    })
  }, [n.notify])
  return null
}

test("a banner above the pane row no longer pushes the last card under the footer, and the failure replaces its ✓", async () => {
  const h = await renderComponent(
    <NotificationsProvider>
      <box flexDirection="column" width={100} height={30}>
        <box height={3}>
          <text>BANNER</text>
        </box>
        <box flexGrow={1}>
          <Push />
          <ToastOverlay />
        </box>
        <box height={1}>
          <text>FOOTER</text>
        </box>
      </box>
    </NotificationsProvider>,
    { width: 100, height: 30 },
  )
  const rows = (await h.frame()).split("\n")
  // A caller's own hint replaces the generic one, shown whole: the reason and the retry both readable.
  const hint = rows.findIndex((row) => row.includes("retry."))
  // The pane row ends at 28, the footer is 29: the hint keeps one blank row above the footer.
  expect(hint).toBe(27)
  expect(rows.join(" ").replace(/\s+/g, " ")).toContain("ENGINE_LIMIT: the cap is 1. Press ⏎ on the task to retry.")
  expect(rows.some((row) => row.includes("Creating task"))).toBe(false)
  h.destroy()
})
