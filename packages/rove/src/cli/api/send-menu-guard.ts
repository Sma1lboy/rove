/**
 * `send` refuses a tab whose engine is showing an approval or question menu. A send is a paste plus
 * Enter: the menu ignores the paste and Enter confirms its highlighted option (an approval), while
 * the pasted text waits in the engine's input and rides along with the next message. Answering
 * "No" this way approved the command. The daemon judges it (`send.check`) with the rule the prompt
 * queue pastes under: the tab's `needs-input` row status (so a question a client just answered with
 * keys no longer refuses), or a rest that came straight from a menu (a stray Stop). A tab that only
 * just came to rest is read again once a menu event trailing the Stop could have landed.
 */

import type { RowStatusPayload } from "@sma1lboy/rove-daemon/daemon/row-status-store"
import type { DaemonRpc } from "../daemon-session.ts"
import type { ActivityView } from "./activity-view.ts"
import { ApiError } from "./types.ts"

interface MenuCheck {
  readonly waiting: string[] | null
  readonly settleMs: number
}

async function checkMenu(
  daemon: DaemonRpc,
  taskId: string,
  tab: string | undefined,
  fallback: ActivityView | null,
): Promise<MenuCheck> {
  try {
    const reply = await daemon.request<{ awaiting: string[]; settleMs: number }>("send.check", {
      taskId,
      ...(tab ? { tabId: tab } : {}),
    })
    return { waiting: reply.awaiting.length > 0 ? reply.awaiting : null, settleMs: reply.settleMs }
  } catch {
    // An older daemon: its row status is all there is.
  }
  let tabs: RowStatusPayload["tasks"][string]["tabs"] | undefined
  try {
    tabs = (await daemon.request<RowStatusPayload>("status.list")).tasks[taskId]?.tabs
  } catch {
    // No row status either: the ledger is all there is.
    return { waiting: fallback?.state === "permission_needed" ? (tab ? [tab] : []) : null, settleMs: 0 }
  }
  const waiting = Object.entries(tabs ?? {})
    .filter(([id, s]) => s.kind === "needs-input" && (tab === undefined || id === tab))
    .map(([id]) => id)
  return { waiting: waiting.length > 0 ? waiting : null, settleMs: 0 }
}

/**
 * Tabs of `taskId` showing a menu: `tab` alone when named, else any of the task's tabs. A tab that just
 * came to rest waits out the daemon's settle window and is read again, right before the caller pastes.
 */
export async function tabsAwaitingChoice(
  daemon: DaemonRpc,
  taskId: string,
  tab: string | undefined,
  fallback: ActivityView | null,
): Promise<string[] | null> {
  let check = await checkMenu(daemon, taskId, tab, fallback)
  if (check.waiting === null && check.settleMs > 0) {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, check.settleMs)
    await promise
    check = await checkMenu(daemon, taskId, tab, fallback)
  }
  return check.waiting
}

export function awaitingChoiceError(taskId: string, tabs: readonly string[]): ApiError {
  const where = tabs.length > 0 ? ` (${tabs.join(", ")})` : ""
  return new ApiError(
    `not sent: task ${taskId}${where} is showing an approval or question menu (or came to rest straight from one); a paste would land in it and Enter would confirm the highlighted option`,
    "AWAITING_PERMISSION",
    {
      taskId,
      ...(tabs.length > 0 ? { tabIds: tabs } : {}),
      hint: "answer the menu with keys in the task's terminal (the TUI, or the web page's keys), then send again; read the menu with read-output --source terminal",
      nextCommandArgs: ["api", "read-output", "--task-id", taskId, "--source", "terminal"],
    },
  )
}
