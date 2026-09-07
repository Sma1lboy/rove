/**
 * Daemon push-channel event handling for `RemoteOrchestrator` — the INBOUND
 * direction, the one place the daemon drives us rather than the other way
 * round. It is the third side of the same split: `-reads.ts` answers from the
 * local cache, `-writes.ts` pushes RPCs out, and this is what keeps that cache
 * true as the daemon reports changes.
 *
 * Taking an explicit {@link OrchestratorSignals} deps bag instead of closing
 * over `this` is what makes that testable: hand it plain closures and drive
 * event payloads through with no daemon and no class.
 */

import { logClientError } from "@sma1lboy/kobe-daemon/client/client-log"
import {
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
import {
  type AttentionInboxItem,
  type EngineLifecycleState,
  type OrchestratorSignals,
  type TaskEngineState,
  type TaskJobState,
  decodeUiPrefsPayload,
  describePayload,
  deserializeTask,
  parseContextUsagePayload,
  parseTranscriptActivityPayload,
  parseUsageSnapshotPayload,
  parseWorktreeChangesPayload,
  sameContextUsageMap,
  sameTranscriptActivityMap,
  sameUsageSnapshotMap,
  sameWorktreeChangesMap,
} from "./remote-orchestrator-payloads.ts"

/**
 * Drop engine-state entries for tasks that are gone (leak guard).
 * The `engine-state` channel only removes an entry on an explicit `idle`
 * event for that taskId — a task deleted/pruned while non-idle (running /
 * permission-needed / error, the common delete case) never gets one, so
 * in a long-lived pane process the map grows one stale entry per deleted
 * task, forever. Reconcile against each `task.snapshot`: any key
 * absent from the authoritative task list is dead. Benign race: an
 * `engine-state` event arriving before the snapshot that introduces its
 * task would be dropped here — the next engine-state event re-adds it
 * (and in practice the daemon publishes the create snapshot before the
 * engine ever starts). No-op (no signal write) when nothing is stale.
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
  // Same leak guard for the per-tab map — a task deleted while a tab is
  // non-idle never delivers its per-tab idle events to a client that was
  // disconnected for them.
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
  // Same guard for the transient lifecycle marks (subagent counts).
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
 * Drop task-job entries for tasks that are gone — the same leak
 * guard as {@link pruneEngineState}. A `done`/`error` publish normally
 * clears the entry, but a task DELETED while its job runs (or a dropped
 * terminal frame across a reconnect) would otherwise pin a phantom
 * "materializing" row state forever in a long-lived pane process.
 * No-op (no signal write) when nothing is stale.
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
      // Dropping this leaves the task list frozen at the last good snapshot;
      // log the anomaly so a stuck-list incident is diagnosable.
      logClientError("orch", `dropped task.snapshot event: tasks is not an array (got ${describePayload(value)})`)
    }
    return
  }
  // The daemon's own obituary (v5) — a lifecycle frame, not a channel, so it
  // is never replayed to a late subscriber as if current. Only `restart` is
  // acted on: it says an operator is swapping the daemon's code, which makes
  // this process the one about to be a build behind. Every other reason
  // (idle, socket-lost, a plain stop) is a shutdown the reconnect loop
  // already handles silently, and deliberately paints nothing — see the
  // no-disconnect-banner rule in `host-banner.tsx`.
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
    // Accumulate per-task into a fresh Map (new ref → re-render). A tabId-
    // carrying event updates BOTH levels: the daemon publishes one event per
    // report, and the task entry is its last-event-wins rollup — EXCEPT that
    // a tab-scoped idle only clears a rollup the SAME tab wrote: the activity
    // observer publishes per-tab idles for quiet sessions, and letting any
    // tab's idle delete the rollup blanks a task whose live work — another
    // tab, or an untagged external session — is still going.
    const prevTask = signals.engineStateAcc().get(p.taskId)
    const prevTaskState = prevTask?.state
    const next = new Map(signals.engineStateAcc())
    if (p.state === "idle") {
      if (!tabId || prevTask?.tabId === tabId) next.delete(p.taskId)
    } else next.set(p.taskId, entry)
    signals.setEngineStateSig(next)
    // Transient lifecycle marks (subagent counts) must never outlive
    // the evidence: a turn ending clears them, and so does a FRESH running
    // edge — a cancelled compaction never sends post-compact, and an
    // esc-interrupted turn may send no idle/stop either, so the next
    // prompt's running edge is the label's only chance to un-stick. (A turn
    // that auto-compacts at its very start may briefly lose the word to
    // this edge — it self-heals; a stuck label doesn't.)
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
      // An idle entry is KEPT as a tombstone, not deleted: the
      // sidebar renders absence as UNKNOWN (no signal — a dotted ◌), so
      // "the daemon said this tab is idle" must stay distinguishable from
      // "the daemon never said anything". Bounded by tabs-per-task; the
      // task.snapshot prune drops deleted tasks' maps wholesale.
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
    // Per ITEM, not `every`: this payload is the whole Inbox, so rejecting it
    // wholesale for one unrecognized row silently blanks a queue whose entire
    // job is to be noticed — no count, no rows, and nothing to dismiss, on
    // every republish and every fresh attach. A newer daemon's state, or one
    // corrupt line on disk, must cost exactly its own row.
    const kept = items.filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false
      const p = item as Partial<AttentionInboxItem>
      // Same rule as the daemon's `normalizeItem`: `null` is legal only for a
      // routine episode. A routine episode may equally NAME a task — a firing
      // that built one and then failed to start its engine carries that id
      // (see `AttentionInboxItem.taskId`), and demanding `null` here rejected
      // the episode the daemon actually writes.
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
    // Nothing readable at ALL is not evidence the queue is empty — that is the
    // one case the old whole-event drop got right, so keep the previous
    // snapshot rather than invent an empty one. A genuinely empty Inbox
    // arrives as `items: []` and still publishes.
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
    // Terminal phases (`done` / `error`) remove the entry. Skip the signal
    // write when nothing is tracked — a replayed terminal payload to a
    // late subscriber must be a true no-op, not a map-identity churn.
    if ((p.phase === "done" || p.phase === "error") && current.has(p.taskId)) {
      const next = new Map(current)
      next.delete(p.taskId)
      signals.setTaskJobsSig(next)
    }
    return
  }
  if (name === "usage.snapshot") {
    const next = parseUsageSnapshotPayload(payload)
    if (!next) {
      // malformed → never clobber a good map, but log the drop.
      logClientError("orch", `dropped usage.snapshot event: malformed usage payload (${describePayload(payload)})`)
      return
    }
    const current = signals.usageSnapshotAcc()
    if (current && sameUsageSnapshotMap(current, next)) return
    signals.setUsageSnapshotSig(next)
    return
  }
  if (name === "usage.context") {
    const next = parseContextUsagePayload(payload)
    if (!next) {
      logClientError("orch", `dropped usage.context event: malformed context payload (${describePayload(payload)})`)
      return
    }
    const current = signals.contextUsageAcc()
    if (current && sameContextUsageMap(current, next)) return
    signals.setContextUsageSig(next)
    return
  }
  if (name === "worktree.changes") {
    const next = parseWorktreeChangesPayload(payload)
    if (!next) {
      // malformed → never clobber a good map, but log the drop.
      logClientError("orch", `dropped worktree.changes event: malformed changes payload (${describePayload(payload)})`)
      return
    }
    // Value-equality gate: an unchanged republish (bus replay across a
    // reconnect, or a daemon publish that round-trips to the same counts)
    // must not swap the map reference and re-render every sidebar row.
    const current = signals.worktreeChangesAcc()
    if (current && sameWorktreeChangesMap(current, next)) return
    signals.setWorktreeChangesSig(next)
    return
  }
  if (name === "transcript.activity") {
    const next = parseTranscriptActivityPayload(payload)
    if (!next) {
      // malformed → never clobber a good map, but log the drop.
      logClientError(
        "orch",
        `dropped transcript.activity event: malformed activity payload (${describePayload(payload)})`,
      )
      return
    }
    // Value-equality gate: an unchanged republish (bus replay across a
    // reconnect, or a daemon publish that round-trips to the same facts)
    // must not swap the map reference and re-run every Ops pane effect.
    const current = signals.transcriptActivityAcc()
    if (current && sameTranscriptActivityMap(current, next)) return
    signals.setTranscriptActivitySig(next)
    return
  }
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
    // `title` may legitimately be "" (clear back to the default name), so the
    // gate is the TYPE, never truthiness.
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
    // Compaction kinds are intentionally ignored here: pre-compact has no
    // guaranteed post-compact (esc cancels it), so any flag it set would
    // outlive its evidence. Compaction reads as the running animation.
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
