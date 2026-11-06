/**
 * `send --handoff-from tab-N`: the brief that carries one tab's conversation
 * into another engine's first prompt. The same planner the TUI and web dialogs
 * run (`planWorktreeHandoff`), so every entry point sends the same text.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { taskCwd } from "../../orchestrator/task-tree.ts"
import { liveSourceProtocol, planWorktreeHandoff } from "../../tui-react/workspace/fork-chat-tab.ts"
import type { VendorId } from "../../types/vendor.ts"
import { daemonOf } from "./handler-helpers.ts"
import { readDaemonTabs, readTabsSnapshot } from "./tab-snapshot.ts"
import { ApiError, type VerbContext, helpStep } from "./types.ts"

export async function handoffBrief(ctx: VerbContext, task: SerializedTask, tabId: string): Promise<string> {
  if (!/^tab-[A-Za-z0-9-]+$/.test(tabId)) {
    throw new ApiError(`--handoff-from must be a tab id like tab-2 (got ${JSON.stringify(tabId)})`, "BAD_TAB")
  }
  const tabs = (await readDaemonTabs(daemonOf(ctx), task.id))?.tabs ?? readTabsSnapshot(task.id)?.tabs ?? []
  const source = tabs.find((t) => t.id === tabId)
  if (!source) throw new ApiError(`task ${task.id} has no tab ${tabId}`, "TAB_NOT_FOUND", { taskId: task.id, tabId })
  if (source.kind !== "engine") {
    throw new ApiError(`${tabId} is not an engine conversation; nothing to hand over`, "BAD_FLAG", helpStep("send"))
  }
  const tabVendor = (source.vendor ?? task.vendor) as VendorId
  const plan = await planWorktreeHandoff(source, liveSourceProtocol(source, tabVendor), taskCwd(task), task.title)
  if (plan.kind === "handoff") return plan.prompt
  throw new ApiError(
    plan.kind === "no-transcript"
      ? `${plan.engine} keeps no transcript Rove can name, so ${tabId} cannot be handed to another engine`
      : `${tabId} has no conversation yet; send the prompt directly`,
    plan.kind === "no-transcript" ? "NO_TRANSCRIPT" : "NO_CONVERSATION",
    { taskId: task.id, tabId },
  )
}
