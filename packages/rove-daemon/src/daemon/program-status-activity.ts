import type { DaemonActivityRegistry } from "./activity-registry"
import type { AttentionInboxStore } from "./attention-inbox"
import { type DeliveryDeps, trackDeliveryTurn } from "./delivery-ops"
import { statusActivity } from "./osc-signals"
import type { ProgramStatusEvent } from "./program-status-event"

/** One arbiter for socket events and inventory recovery, including clear tombstones. */
export function programStatusActivity(
  activity: DaemonActivityRegistry,
  taskExists: (id: string) => boolean,
  inbox?: Pick<AttentionInboxStore, "record" | "deleteEpisode">,
  deliveries?: DeliveryDeps,
  /** The task a PTY's conversation belongs to (a migrated child owns its parent-keyed PTY); default the key's task. */
  ownerOf: (taskId: string, tabId: string) => string = (id) => id,
): (event: ProgramStatusEvent) => Promise<void> {
  const seen = new Map<string, { event: ProgramStatusEvent; owns?: () => boolean }>()
  return async (event) => {
    const [keyTask, tabId, extra] = event.key.split("::")
    if (!keyTask || !tabId || extra !== undefined || !/^tab-\d+$/.test(tabId)) return
    const taskId = ownerOf(keyTask, tabId)
    if (!taskExists(taskId)) return
    const previous = seen.get(event.key)
    if (previous?.event.generation === event.generation && previous.event.revision >= event.revision) return
    if (previous && previous.event.generation !== event.generation && previous.event.at > event.at) return
    const ownClaim = previous?.owns?.() === true
    const next: { event: ProgramStatusEvent; owns?: () => boolean } = { event }
    seen.delete(event.key)
    seen.set(event.key, next)
    if (seen.size > 4096) {
      const first = seen.keys().next().value
      if (first !== undefined) seen.delete(first)
    }
    if (event.status === null) {
      if (ownClaim) {
        activity.reportProgramStatus(taskId, tabId, "turn-interrupted", undefined, undefined, event.at)
        await inbox?.deleteEpisode(taskId, tabId)
      }
      return
    }
    // Equal clocks prefer a hook, but consecutive OSC reports share a millisecond.
    if (!ownClaim && activity.hasHookSince(taskId, tabId, event.at)) return
    const report = statusActivity(event.status)
    next.owns = activity.reportProgramStatus(taskId, tabId, report.kind, report.detail, undefined, event.at)
    if (event.status.state === "idle") await inbox?.deleteEpisode(taskId, tabId)
    else await inbox?.record(taskId, report.kind, report.detail, tabId)
    if (deliveries) await trackDeliveryTurn(deliveries, taskId, tabId, report.kind, report.detail)
  }
}
