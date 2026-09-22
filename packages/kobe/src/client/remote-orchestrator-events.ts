/**
 * Inbound daemon push events for `RemoteOrchestrator`: keeps the local cache
 * true. Takes an {@link OrchestratorSignals} deps bag so tests drive payloads
 * with no daemon and no class.
 */

import { logClientError } from "@sma1lboy/kobe-daemon/client/client-log"
import {
  type GraphicsWritePayload,
  type NoticeEventPayload,
  type SerializedTask,
  type TabClosePayload,
  type TabOpenPayload,
  type TabRenamePayload,
  type UiPromptPayload,
  isAttentionInboxState,
  parseDaemonStopReason,
} from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { EngineActivityDetail, TaskActivityState } from "../engine/hook-events.ts"
import type { UpdateInfo } from "../version.ts"
import { handleMapChannel } from "./remote-orchestrator-map-events.ts"
import {
  type AttentionInboxItem,
  type EngineLifecycleState,
  type OrchestratorSignals,
  type TaskEngineState,
  type TaskJobState,
  decodeUiPrefsPayload,
  describePayload,
  deserializeTask,
} from "./remote-orchestrator-payloads.ts"

/**
 * Default `graphics.write` sink: fd 1, verbatim, unparsed. Every attached
 * GUI writes it to its own terminal (each keeps its own image store). Not
 * queued for a frame boundary: the renderer emits each frame in one `write`,
 * so the payload lands between frames (measured against a real terminal).
 */
export function writeGraphicsToStdout(data: Buffer): void {
  // Binary into a redirected stdout corrupts the capture and draws nothing.
  if (!process.stdout.isTTY) return
  process.stdout.write(data)
}

/**
 * Leak guard: entries are only removed on an explicit `idle`, which a task
 * deleted while non-idle never sends, so reconcile against each
 * `task.snapshot`. Benign race: an event before its task's first snapshot is
 * dropped until the next one (the daemon publishes the create snapshot before
 * the engine starts). No signal write when nothing is stale.
 */
function pruneEngineState(tasks: readonly SerializedTask[], signals: OrchestratorSignals): void {
  const live = new Set(tasks.map((t) => t.id))
  const current = signals.engineStateAcc()
  if (current.size > 0) {
    let next: Map<string, TaskEngineState> | null = null
    for (const key of current.keys()) {
      if (live.has(key)) continue
      if (!next) next = new Map(current)
      next.delete(key)
    }
    if (next) signals.setEngineStateSig(next)
  }
  const tabs = signals.engineTabStateAcc()
  if (tabs.size > 0) {
    let nextTabs: Map<string, ReadonlyMap<string, TaskEngineState>> | null = null
    for (const key of tabs.keys()) {
      if (live.has(key)) continue
      if (!nextTabs) nextTabs = new Map(tabs)
      nextTabs.delete(key)
    }
    if (nextTabs) signals.setEngineTabStateSig(nextTabs)
  }
  const lifecycle = signals.engineLifecycleAcc()
  if (lifecycle.size > 0) {
    let nextLifecycle: Map<string, EngineLifecycleState> | null = null
    for (const key of lifecycle.keys()) {
      if (live.has(key)) continue
      if (!nextLifecycle) nextLifecycle = new Map(lifecycle)
      nextLifecycle.delete(key)
    }
    if (nextLifecycle) signals.setEngineLifecycleSig(nextLifecycle)
  }
}

/**
 * Same leak guard as {@link pruneEngineState}: a task deleted mid-job, or a
 * `done` frame lost across a reconnect, would pin "materializing" forever.
 */
function pruneTaskJobs(tasks: readonly SerializedTask[], signals: OrchestratorSignals): void {
  const current = signals.taskJobsAcc()
  if (current.size === 0) return
  const live = new Set(tasks.map((t) => t.id))
  let next: Map<string, TaskJobState> | null = null
  for (const key of current.keys()) {
    if (live.has(key)) continue
    if (!next) next = new Map(current)
    next.delete(key)
  }
  if (next) signals.setTaskJobsSig(next)
}

export function handleOrchestratorEvent(name: string, payload: unknown, signals: OrchestratorSignals): void {
  if (name === "task.snapshot") {
    const value = (payload as { tasks?: SerializedTask[] } | undefined)?.tasks
    if (Array.isArray(value)) {
      signals.setTasks(value.map(deserializeTask))
      pruneEngineState(value, signals)
      pruneTaskJobs(value, signals)
    } else {
      // Logged so a frozen task list is diagnosable.
      logClientError("orch", `dropped task.snapshot event: tasks is not an array (got ${describePayload(value)})`)
    }
    return
  }
  // Lifecycle frame (v5), never replayed. Only `restart` is acted on (this
  // process is about to be a build behind); other reasons paint nothing —
  // see the no-disconnect-banner rule in `host-banner.tsx`.
  if (name === "daemon.stopping") {
    const p = payload as { reason?: unknown; kobeVersion?: unknown } | undefined
    if (typeof p?.kobeVersion === "string") signals.setDaemonVersionSig(p.kobeVersion)
    if (parseDaemonStopReason(p?.reason) === "restart") signals.setDaemonRestartingSig(true)
    return
  }
  if (name === "active-task") {
    const id = (payload as { taskId?: string | null } | undefined)?.taskId
    signals.setActiveTaskSig(typeof id === "string" ? id : null)
    return
  }
  if (name === "update") {
    const info = (payload as { info?: UpdateInfo | null } | undefined)?.info
    signals.setUpdateSig(info ?? null)
    return
  }
  if (name === "engine-state") {
    const p = payload as {
      taskId?: string
      tabId?: string
      state?: TaskActivityState
      detail?: EngineActivityDetail
      sessionId?: string
      transcriptPath?: string
      at?: number
    }
    if (typeof p?.taskId !== "string" || typeof p.state !== "string") {
      logClientError(
        "orch",
        `dropped engine-state event: taskId/state must be strings (taskId=${describePayload(p?.taskId)}, state=${describePayload(p?.state)})`,
      )
      return
    }
    const tabId = typeof p.tabId === "string" && p.tabId ? p.tabId : undefined
    const entry: TaskEngineState = {
      state: p.state,
      detail: p.detail,
      ...(typeof p.sessionId === "string" && p.sessionId ? { sessionId: p.sessionId } : {}),
      ...(typeof p.transcriptPath === "string" && p.transcriptPath ? { transcriptPath: p.transcriptPath } : {}),
      ...(tabId ? { tabId } : {}),
      at: typeof p.at === "number" ? p.at : 0,
    }
    // The task rollup comes only from TASK-level events (no `tabId`); the
    // daemon owns the rollup rule (activity-rollup.ts) — don't re-derive it.
    const prevTaskState = signals.engineStateAcc().get(p.taskId)?.state
    if (!tabId) {
      const next = new Map(signals.engineStateAcc())
      if (p.state === "idle") next.delete(p.taskId)
      else next.set(p.taskId, entry)
      signals.setEngineStateSig(next)
    }
    // Lifecycle marks must not outlive the evidence: cleared on turn end AND
    // on a fresh running edge, since an esc-interrupted turn may send no
    // idle/stop. An auto-compact at turn start may briefly lose its label —
    // self-heals, unlike a stuck one.
    const endsMarks =
      p.state === "idle" ||
      p.state === "turn_complete" ||
      p.state === "error" ||
      (p.state === "running" && prevTaskState !== "running")
    if (endsMarks && signals.engineLifecycleAcc().has(p.taskId)) {
      const lifecycle = new Map(signals.engineLifecycleAcc())
      lifecycle.delete(p.taskId)
      signals.setEngineLifecycleSig(lifecycle)
    }
    if (tabId) {
      // Idle is KEPT as a tombstone: absence renders as UNKNOWN (◌), which
      // must differ from "said idle". Bounded by tabs-per-task.
      const nextTabs = new Map(signals.engineTabStateAcc())
      const tabs = new Map(nextTabs.get(p.taskId) ?? [])
      tabs.set(tabId, entry)
      nextTabs.set(p.taskId, tabs)
      signals.setEngineTabStateSig(nextTabs)
    }
    return
  }
  if (name === "attention.inbox") {
    const items = (payload as { items?: unknown } | undefined)?.items
    if (!Array.isArray(items)) {
      logClientError("orch", `dropped attention.inbox event: items is not an array (${describePayload(items)})`)
      return
    }
    // Per ITEM, not `every`: one unrecognized row (newer daemon, corrupt
    // line) must cost only its own row, not blank the whole Inbox.
    const kept = items.filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false
      const p = item as Partial<AttentionInboxItem>
      // Matches the daemon's `normalizeItem`: `null` only for a routine
      // episode, which may also name a task (see `AttentionInboxItem.taskId`).
      const taskIdOk = typeof p.taskId === "string" || (p.taskId === null && p.state === "routine_failed")
      return (
        taskIdOk &&
        (p.tabId === null || typeof p.tabId === "string") &&
        isAttentionInboxState(p.state) &&
        (p.unread === undefined || typeof p.unread === "boolean") &&
        typeof p.at === "number"
      )
    })
    if (kept.length !== items.length) {
      logClientError(
        "orch",
        `dropped ${items.length - kept.length} malformed attention.inbox item(s) of ${items.length} (${describePayload(items)})`,
      )
    }
    // Nothing readable isn't evidence of empty: keep the previous snapshot.
    // A real empty Inbox arrives as `items: []`.
    if (kept.length === 0 && items.length > 0) return
    signals.setAttentionInboxSig(
      kept.map((item) => ({
        ...(item as AttentionInboxItem),
        unread: (item as Partial<AttentionInboxItem>).unread !== false,
      })),
    )
    return
  }
  if (name === "task.jobs") {
    const p = payload as { taskId?: string; kind?: string; phase?: string } | undefined
    if (typeof p?.taskId !== "string" || p.kind !== "ensureWorktree") {
      logClientError(
        "orch",
        `dropped task.jobs event: expected string taskId + kind "ensureWorktree" (taskId=${describePayload(p?.taskId)}, kind=${describePayload(p?.kind)})`,
      )
      return
    }
    const current = signals.taskJobsAcc()
    if (p.phase === "running") {
      const next = new Map(current)
      next.set(p.taskId, { kind: p.kind })
      signals.setTaskJobsSig(next)
      return
    }
    // A replayed terminal payload must be a true no-op, not identity churn.
    if ((p.phase === "done" || p.phase === "error") && current.has(p.taskId)) {
      const next = new Map(current)
      next.delete(p.taskId)
      signals.setTaskJobsSig(next)
    }
    return
  }
  if (handleMapChannel(name, payload, signals)) return
  if (name === "tab.open") {
    const p = payload as Partial<TabOpenPayload> | undefined
    if (
      typeof p?.taskId !== "string" ||
      typeof p.at !== "number" ||
      typeof p.title !== "string" ||
      !Array.isArray(p.argv)
    ) {
      logClientError("orch", `dropped tab.open event: malformed payload (${describePayload(payload)})`)
      return
    }
    signals.setTabOpenSig(p as TabOpenPayload)
    return
  }
  if (name === "tab.close") {
    const p = payload as Partial<TabClosePayload> | undefined
    const terminalTab = p && "kind" in p && p.kind === "terminal-tab"
    const valid = terminalTab
      ? typeof p.taskId === "string" &&
        typeof p.tabId === "string" &&
        typeof p.requestId === "string" &&
        typeof p.at === "number"
      : typeof p?.taskId === "string" && typeof p.at === "number" && "title" in p && typeof p.title === "string"
    if (!valid) {
      logClientError("orch", `dropped tab.close event: malformed payload (${describePayload(payload)})`)
      return
    }
    signals.setTabCloseSig(p as TabClosePayload)
    return
  }
  if (name === "tab.rename") {
    const p = payload as Partial<TabRenamePayload> | undefined
    // `title` may be "" (reset to default): gate on type, not truthiness.
    if (
      typeof p?.taskId !== "string" ||
      typeof p.tabId !== "string" ||
      typeof p.title !== "string" ||
      typeof p.at !== "number"
    ) {
      logClientError("orch", `dropped tab.rename event: malformed payload (${describePayload(payload)})`)
      return
    }
    signals.setTabRenameSig(p as TabRenamePayload)
    return
  }
  if (name === "ui.prompt") {
    const p = payload as Partial<UiPromptPayload> | undefined
    if (typeof p?.promptId !== "string" || typeof p.title !== "string" || typeof p.at !== "number") {
      logClientError("orch", `dropped ui.prompt event: malformed payload (${describePayload(payload)})`)
      return
    }
    signals.setUiPromptSig(p as UiPromptPayload)
    return
  }
  if (name === "engine.lifecycle") {
    const p = payload as { taskId?: string; kind?: string } | undefined
    if (typeof p?.taskId !== "string" || typeof p.kind !== "string") {
      logClientError("orch", `dropped engine.lifecycle event: malformed payload (${describePayload(payload)})`)
      return
    }
    // Compaction kinds ignored: esc cancels post-compact, so a flag would
    // outlive its evidence.
    const prev = signals.engineLifecycleAcc()
    const cur = prev.get(p.taskId) ?? { subagents: 0 }
    const entry =
      p.kind === "subagent-start"
        ? { subagents: cur.subagents + 1 }
        : p.kind === "subagent-stop"
          ? { subagents: Math.max(0, cur.subagents - 1) }
          : cur
    if (entry === cur && !prev.has(p.taskId)) return
    const map = new Map(prev)
    if (entry.subagents === 0) map.delete(p.taskId)
    else map.set(p.taskId, entry)
    signals.setEngineLifecycleSig(map)
    return
  }
  if (name === "graphics.write") {
    const p = payload as Partial<GraphicsWritePayload> | undefined
    if (typeof p?.data !== "string" || typeof p.imageId !== "number" || typeof p.at !== "number") {
      logClientError("orch", `dropped graphics.write event: malformed payload (${describePayload(payload)})`)
      return
    }
    // Base64 is our own transport encoding, not the caller's content.
    signals.writeGraphics(Buffer.from(p.data, "base64"))
    return
  }
  if (name === "notice.event") {
    const p = payload as Partial<NoticeEventPayload> | undefined
    if (typeof p?.title !== "string" || typeof p.at !== "number" || typeof p.kind !== "string") {
      logClientError("orch", `dropped notice.event: malformed payload (${describePayload(payload)})`)
      return
    }
    signals.setNoticeSig(p as NoticeEventPayload)
    return
  }
  if (name === "ui-prefs") {
    const decoded = decodeUiPrefsPayload(payload)
    if (!decoded) {
      const theme = (payload as { theme?: unknown } | undefined)?.theme
      logClientError("orch", `dropped ui-prefs event: theme must be a string (got ${describePayload(theme)})`)
      return
    }
    signals.setUiPrefsSig(decoded)
    return
  }
  if (name === "keybindings") {
    const p = payload as { rev?: number } | undefined
    if (typeof p?.rev !== "number") {
      logClientError("orch", `dropped keybindings event: rev must be a number (got ${describePayload(p?.rev)})`)
      return
    }
    signals.setKeybindingsRevSig(p.rev)
  }
}
