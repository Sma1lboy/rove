/** @jsxImportSource @opentui/react */
/**
 * Toast cards must stay INSIDE their pane: long copy ends in `…` rather than
 * a bare hard cut, and on a terminal narrower than the card the stack clamps
 * instead of poking left across the neighbouring pane.
 */

import { describe, expect, it } from "bun:test"
import { ToastOverlay } from "../../src/tui-react/component/toast-overlay"
import { useNotifications } from "../../src/tui-react/context/notifications"
import { act, renderComponent } from "./harness"

const LONG_TITLE = "Fix the sidebar unread lamp across every repository group"
const LONG_BODY = "fixture-repo › second opinion: root-cause the stale badge before the sweep"

/** Pushes one toast on mount, then renders the overlay under test. */
function Harness() {
  const notif = useNotifications()
  if (notif.toasts.length === 0)
    notif.notify({ kind: "done", taskId: "t1", tabId: "tab-1", title: LONG_TITLE, body: LONG_BODY })
  return <ToastOverlay />
}

const mount = (width: number) => renderComponent(<Harness />, { width, height: 12, providers: { notifications: true } })

describe("ToastOverlay truncation", () => {
  it("ends an over-long title in an ellipsis instead of a hard cut", async () => {
    const { frame } = await mount(60)
    await act(async () => {})
    const out = await frame()
    expect(out).toContain("…")
    // The full string never fits a 60-cell terminal's card.
    expect(out).not.toContain(LONG_TITLE)
    // But enough of the front survives to identify the toast.
    expect(out).toContain("Fix the sidebar")
  })

  it("keeps the card inside a terminal narrower than the card itself", async () => {
    const { frame } = await mount(24)
    await act(async () => {})
    const out = await frame()
    for (const line of out.split("\n")) expect(line.length).toBeLessThanOrEqual(24)
  })
})
