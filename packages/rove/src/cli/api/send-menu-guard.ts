/**
 * `send` refuses a tab whose engine is showing an approval or question menu. A send is a paste plus
 * Enter: the menu ignores the paste and Enter confirms its highlighted option (an approval), while
 * the pasted text waits in the engine's input and rides along with the next message. Answering
 * "No" this way approved the command. The tab's `needs-input` is the row status every client
 * shows (`status.list`), so a question a client just answered with keys no longer refuses.
 */

import type { RowStatusPayload } from "@sma1lboy/rove-daemon/daemon/row-status-store"
import type { DaemonRpc } from "../daemon-session.ts"
import type { ActivityView } from "./activity-view.ts"
import { ApiError } from "./types.ts"

/** Tabs of `taskId` showing a menu: `tab` alone when named, else any of the task's tabs. */
export async function tabsAwaitingChoice(
  daemon: DaemonRpc,
  taskId: string,
  tab: string | undefined,
  fallback: ActivityView | null,
): Promise<string[] | null> {
  let tabs: RowStatusPayload["tasks"][string]["tabs"] | undefined
  try {
    tabs = (await daemon.request<RowStatusPayload>("status.list")).tasks[taskId]?.tabs
  } catch {
    // No row status (an older daemon): the ledger is all there is.
    return fallback?.state === "permission_needed" ? (tab ? [tab] : []) : null
  }
  const waiting = Object.entries(tabs ?? {})
    .filter(([id, s]) => s.kind === "needs-input" && (tab === undefined || id === tab))
    .map(([id]) => id)
  return waiting.length > 0 ? waiting : null
}

export function awaitingChoiceError(taskId: string, tabs: readonly string[]): ApiError {
  const where = tabs.length > 0 ? ` (${tabs.join(", ")})` : ""
  return new ApiError(
    `not sent: task ${taskId}${where} is showing an approval or question menu; a paste would land in it and Enter would confirm the highlighted option`,
    "AWAITING_PERMISSION",
    {
      taskId,
      ...(tabs.length > 0 ? { tabIds: tabs } : {}),
      hint: "answer the menu with keys in the task's terminal (the TUI, or the web page's keys), then send again; read the menu with read-output --source terminal",
      nextCommandArgs: ["api", "read-output", "--task-id", taskId, "--source", "terminal"],
    },
  )
}
