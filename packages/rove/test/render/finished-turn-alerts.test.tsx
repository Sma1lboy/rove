/** @jsxImportSource @opentui/react */
/**
 * Switching off finished-turn alerts leaves approvals and errors loud and
 * keeps every unread mark. Drives the real KV + notifications providers, so
 * the switch is read the way Settings writes it.
 */

import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useKV } from "../../src/tui-react/context/kv"
import { type NotificationsContext, useNotifications } from "../../src/tui-react/context/notifications"
import { FINISHED_ALERTS_KEY } from "../../src/tui/lib/notify-state"
import { act, renderComponent } from "./harness"

let home: string
let savedHome: string | undefined

beforeAll(() => {
  savedHome = process.env.ROVE_HOME_DIR
  home = mkdtempSync(join(tmpdir(), "rove-finished-alerts-"))
  process.env.ROVE_HOME_DIR = home
})

afterAll(() => {
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
  rmSync(home, { recursive: true, force: true })
})

let muteFinished: () => void = () => {}
let notify: NotificationsContext["notify"] = () => {}

function Probe() {
  const kv = useKV()
  const notif = useNotifications()
  muteFinished = () => kv.set(FINISHED_ALERTS_KEY, false)
  notify = notif.notify
  const toasts = notif.toasts.map((t) => `${t.kind}:${t.title}`).join(",") || "none"
  const unread = [...notif.unread.values()].join(",") || "none"
  return <text>{`toasts=${toasts} unread=${unread}`}</text>
}

test("with finished turns off, a finished turn only marks unread; approvals and other toasts still show", async () => {
  const { frame } = await renderComponent(<Probe />, {
    width: 120,
    height: 4,
    providers: { kv: true, notifications: true },
  })
  await act(async () => {
    muteFinished()
  })
  await act(async () => {
    notify({ kind: "done", taskId: "a", tabId: "1", title: "turn", turnEnd: true, silent: true })
    notify({ kind: "needs_input", taskId: "b", tabId: "1", title: "ask", turnEnd: true, silent: true })
    notify({ kind: "done", taskId: "", tabId: "", title: "info", silent: true })
  })

  const text = await frame()
  expect(text).toContain("toasts=needs_input:ask,done:info")
  expect(text).toContain("unread=done,needs_input,done")
})
