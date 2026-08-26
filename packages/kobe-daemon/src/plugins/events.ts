/**
 * Derive discrete plugin events from the daemon's push channels.
 *
 * The channels are STATE snapshots (last-value replay); plugin hooks want
 * edges. This reducer is fed every `bus.publish` and emits the transitions:
 *
 *   task.snapshot diff       → task.created / task.deleted / task.changed /
 *                              task.pr-changed / task.archived / worktree.created
 *   engine-state transitions → agent.* (per task+tab, deduped)
 *
 * `worktree.created` is snapshot-derived (empty → non-empty worktreePath, or
 * a task-kind row born with one) so EVERY materialization path fires it —
 * lazy ensure, adopt, scratch-adopt — not just the ensureWorktree job that an
 * earlier version keyed on. It is deliberately blind to the first snapshot
 * after daemon start — replayed state must not re-fire hooks for tasks that
 * already existed.
 */

import type { ChannelEvent } from "../daemon/event-bus.ts"
import type { ChannelPayloads } from "../daemon/protocol.ts"
import type { SerializedTask } from "../daemon/protocol.ts"
import type { PluginEventName } from "./manifest.ts"
import { bornWithWorktree, diffTask } from "./task-diff.ts"

export interface PluginEvent {
  readonly event: PluginEventName
  readonly taskId?: string
  /** Task context at emit time, when the task is still known. */
  readonly task?: Pick<SerializedTask, "id" | "title" | "repo" | "branch" | "worktreePath" | "vendor" | "status">
  /** Which engine produced it (agent-lifecycle events, when tagged). */
  readonly vendor?: string
  /** Kobe terminal tab, when the session is kobe-spawned. */
  readonly tabId?: string
  /** The engine's own session id, when its hook payload named one. */
  readonly sessionId?: string
  /** Normalized family-specific fields (failure/waiting/tool/compact/subagent). */
  readonly detail?: Record<string, unknown>
  readonly at: number
}

/**
 * Normalized engine verb → agent-lifecycle plugin event
 * (docs/design/plugin-events.md). `awaiting-input` splits on WHY the engine
 * is blocked; unknown/future kinds map to nothing.
 */
export function lifecycleEventFor(kind: string, detail?: { waiting?: string }): PluginEventName | undefined {
  switch (kind) {
    case "session-start":
      return "session.start"
    case "session-end":
      return "session.end"
    case "turn-start":
      return "turn.prompt"
    case "turn-complete":
      return "turn.complete"
    case "turn-failed":
      return "turn.failed"
    case "turn-interrupted":
      return "turn.interrupted"
    case "awaiting-input":
      return detail?.waiting === "input" ? "attention.question" : "attention.permission"
    case "tool-pre":
      return "tool.pre"
    case "tool-post":
      return "tool.post"
    case "tool-failed":
      return "tool.failed"
    case "pre-compact":
      return "context.pre-compact"
    case "post-compact":
      return "context.post-compact"
    case "subagent-start":
      return "subagent.start"
    case "subagent-stop":
      return "subagent.stop"
    default:
      return undefined
  }
}

type EngineState = ChannelPayloads["engine-state"]

const AGENT_EVENT_BY_STATE: Partial<Record<EngineState["state"], PluginEventName>> = {
  turn_complete: "agent.turn-complete",
  permission_needed: "agent.permission-needed",
  rate_limited: "agent.rate-limited",
  error: "agent.error",
  running: "agent.running",
  idle: "agent.idle",
}

function taskContext(task: SerializedTask | undefined): PluginEvent["task"] {
  if (!task) return undefined
  const { id, title, repo, branch, worktreePath, vendor, status } = task
  return { id, title, repo, branch, worktreePath, vendor, status }
}

export class PluginEventReducer {
  private tasks: Map<string, SerializedTask> | undefined
  private readonly agentState = new Map<string, EngineState["state"]>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** Task context for lifecycle events (PluginHost.handleEngineReport). */
  contextFor(taskId: string): PluginEvent["task"] {
    return taskContext(this.tasks?.get(taskId))
  }

  reduce(event: ChannelEvent): PluginEvent[] {
    switch (event.channel) {
      case "task.snapshot":
        return this.reduceTasks((event.payload as ChannelPayloads["task.snapshot"]).tasks)
      case "engine-state":
        return this.reduceEngine(event.payload as EngineState)
      default:
        return []
    }
  }

  private reduceTasks(tasks: SerializedTask[]): PluginEvent[] {
    const next = new Map(tasks.map((t) => [t.id, t]))
    const prev = this.tasks
    this.tasks = next
    // First snapshot after daemon start is baseline, not a burst of creates.
    if (!prev) return []
    const at = this.now()
    const out: PluginEvent[] = []
    for (const [id, task] of next) {
      const before = prev.get(id)
      if (!before) {
        out.push({ event: "task.created", taskId: id, task: taskContext(task), at })
        // Adopt paths create the row WITH its worktree — same moment.
        if (bornWithWorktree(task)) out.push({ event: "worktree.created", taskId: id, task: taskContext(task), at })
        continue
      }
      const diff = diffTask(before, task)
      if (!diff) continue
      const ctx = taskContext(task)
      if (diff.fields.length > 0) {
        out.push({
          event: "task.changed",
          taskId: id,
          task: ctx,
          detail: { fields: diff.fields, from: diff.from, to: diff.to },
          at,
        })
      }
      if (diff.prChanged) {
        out.push({
          event: "task.pr-changed",
          taskId: id,
          task: ctx,
          detail: {
            ...(before.prStatus ? { from: before.prStatus } : {}),
            ...(task.prStatus ? { to: task.prStatus } : {}),
          },
          at,
        })
      }
      if (diff.archivedNow) out.push({ event: "task.archived", taskId: id, task: ctx, at })
      if (diff.worktreeCreated) out.push({ event: "worktree.created", taskId: id, task: ctx, at })
    }
    for (const [id, task] of prev) {
      if (!next.has(id)) out.push({ event: "task.deleted", taskId: id, task: taskContext(task), at })
    }
    return out
  }

  private reduceEngine(payload: EngineState): PluginEvent[] {
    const key = `${payload.taskId}\0${payload.tabId ?? ""}`
    const prev = this.agentState.get(key)
    this.agentState.set(key, payload.state)
    if (prev === payload.state) return []
    const event = AGENT_EVENT_BY_STATE[payload.state]
    if (!event) return []
    return [
      {
        event,
        taskId: payload.taskId,
        task: taskContext(this.tasks?.get(payload.taskId)),
        ...(payload.tabId ? { tabId: payload.tabId } : {}),
        at: this.now(),
      },
    ]
  }
}
