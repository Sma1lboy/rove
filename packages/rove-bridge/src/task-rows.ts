/**
 * The feed's row builders: a daemon task becomes the phone's `TaskRow` (engine, the daemon's row
 * status, change and token chips, PR chip, machine tag), and inbox items become `AttentionRow`s.
 * Pure functions over what `RoveOps.tasks()` gathered; split from rove-ops.ts so it stays within
 * the size cap.
 */

import type { AttentionInboxItem } from "@sma1lboy/rove-daemon/daemon/contracts"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { type TaskStatus, tabStatus, taskStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import { rollupPr } from "@sma1lboy/rove-daemon/task-tree"
import { type ActivityEntry, buildContext } from "@sma1lboy/rove/src/cli/api/context-view.ts"
import {
  type RowTokenMap,
  type WorktreeChangesMap,
  liveRowTokens,
} from "@sma1lboy/rove/src/client/remote-orchestrator.ts"
import { DEFAULT_GLYPHS } from "@sma1lboy/rove/src/tui/lib/glyphs.ts"
import { prChip } from "@sma1lboy/rove/src/tui/panes/sidebar/row-chips.ts"
import type { AttentionRow, MachineTag, PrChipKind, RowChanges, RowTokenChip, TaskRow } from "./protocol.ts"
import type { EngineRow } from "./rove-ops.ts"

/** Name a task's engine from the registry: its exact preset, else its protocol's builtin. */
export function engineFor(task: SerializedTask, engines: readonly EngineRow[]): TaskRow["engine"] {
  const command = task.command?.trim()
  const preset =
    (command ? engines.find((e) => e.id === command || e.command === command) : undefined) ??
    engines.find((e) => e.builtin && e.protocol === task.vendor)
  if (preset) return { id: preset.id, name: preset.name }
  return task.vendor ? { id: null, name: task.vendor } : null
}

/** Live feeds the rows join beyond `task.list`: both come from the daemon pushes the orchestrator already holds. */
export interface RowExtras {
  readonly changes: WorktreeChangesMap | null
  readonly tokens: RowTokenMap
}

/** `worktree.changes` for one row: absent when not collected (never zeros), `unreadable` for a tracked path git could not read. */
function rowChanges(map: WorktreeChangesMap | null, worktreePath: string): RowChanges | undefined {
  if (!map || !map.has(worktreePath)) return undefined
  const c = map.get(worktreePath)
  if (!c) return { unreadable: true }
  return {
    added: c.added,
    deleted: c.deleted,
    ...(c.ahead !== undefined ? { ahead: c.ahead } : {}),
    ...(c.behind !== undefined ? { behind: c.behind } : {}),
  }
}

function rowTokenChips(map: RowTokenMap | undefined, taskId: string, now: number): RowTokenChip[] {
  return liveRowTokens(map, taskId, now).map((t) => ({
    text: t.text,
    ...(t.tone ? { tone: t.tone } : {}),
    source: t.source,
    expiresAt: t.expiresAt,
  }))
}

const PR_CHIP_BY_GLYPH: Record<string, PrChipKind> = {
  [DEFAULT_GLYPHS.conflict]: "conflict",
  [DEFAULT_GLYPHS.checksFailing]: "failing",
  [DEFAULT_GLYPHS.checksPassing]: "passing",
}

/** The sidebar's one PR chip, straight from `row-chips.ts` (conflict > failing > passing), named instead of drawn. */
function prChipKind(task: SerializedTask): PrChipKind | null {
  const chip = prChip(task as unknown as Parameters<typeof prChip>[0])
  return chip ? (PR_CHIP_BY_GLYPH[chip.glyph] ?? null) : null
}

/**
 * The inbox as the phone sees it. Optional, additive fields: `resumeAt` (a rate-limited task's
 * scheduled auto-resume, from its `quotaResume`), `label` (a routine episode's name, since its
 * subject is the routine, not a task), `automationId` (that routine's id), `deliveryId` (a
 * `report_missing` episode's key) and `gateId` (a `decision_needed` row's key into
 * `TasksPayload.gates`).
 */
export function attentionRows(items: readonly AttentionInboxItem[], tasks: readonly SerializedTask[]): AttentionRow[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  return items.map((i) => {
    const resumeAt = i.state === "rate_limited" && i.taskId ? byId.get(i.taskId)?.quotaResume?.resumeAt : undefined
    const label = i.detail?.routine?.name
    const deliveryId = i.state === "report_missing" ? i.detail?.delivery?.id : undefined
    const gateId = i.state === "decision_needed" ? i.detail?.gate?.id : undefined
    const automationId = i.detail?.routine?.automationId
    return {
      taskId: i.taskId,
      tabId: i.tabId,
      state: i.state,
      unread: i.unread,
      at: i.at,
      ...(resumeAt ? { resumeAt } : {}),
      ...(label ? { label } : {}),
      ...(deliveryId ? { deliveryId } : {}),
      ...(gateId ? { gateId } : {}),
      ...(automationId ? { automationId } : {}),
    }
  })
}

/** `machine` for a row another daemon served (`machines/hub.ts` stamps `origin`); a local row has none. */
function machineOf(task: SerializedTask): { machine?: MachineTag } {
  const origin: (SerializedTask["origin"] & { stale?: boolean }) | undefined = task.origin
  if (!origin || origin.machineId === "local") return {}
  return { machine: { id: origin.machineId, label: origin.hostLabel, ...(origin.stale ? { stale: true } : {}) } }
}

/** The daemon's row status (`row.status`) the rows are built on. */
export interface RowStatusInput {
  readonly tasks: Readonly<Record<string, TaskStatus>>
  /** The tabs' `alive` is a PTY host's word. False for statuses built from another machine's pushes, which carry no liveness. */
  readonly liveness: boolean
}

/**
 * Another machine's rows: the hub relays its daemon's `engine-state` (one reading per task), not its
 * `row.status`, so the row status is the daemon's own rule applied to that reading.
 */
export function remoteRowStatus(activity: ReadonlyMap<string, ActivityEntry>): RowStatusInput {
  const tasks: Record<string, TaskStatus> = {}
  for (const [taskId, entry] of activity) {
    const tabless = tabStatus({ activity: { state: entry.state as never, at: entry.at }, viewed: false })
    tasks[taskId] = { task: taskStatus({}, { tabless }), tabs: {} }
  }
  return { tasks, liveness: false }
}

/**
 * The grouping's inputs, read off the daemon's status instead of derived here: the rollup's engine
 * state and when it began, and which tasks have a live tab.
 */
function groupingInputs(status: RowStatusInput | null): {
  activity: Record<string, ActivityEntry> | null
  liveTaskIds: ReadonlySet<string> | null
} {
  if (!status) return { activity: null, liveTaskIds: null }
  const activity: Record<string, ActivityEntry> = {}
  const live = new Set<string>()
  for (const [taskId, { task, tabs }] of Object.entries(status.tasks)) {
    if (task.state) activity[taskId] = { state: task.state, at: task.since }
    if (Object.values(tabs).some((tab) => tab.alive)) live.add(taskId)
  }
  return { activity, liveTaskIds: status.liveness ? live : null }
}

/** Fold `context`'s grouping over EVERY task (main/dir included) and join display fields. */
export function taskRows(
  tasks: readonly SerializedTask[],
  status: RowStatusInput | null,
  engines: readonly EngineRow[],
  now: number,
  extras?: RowExtras,
): TaskRow[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const orderOf = new Map(tasks.map((t, i) => [t.id, i]))
  const context = buildContext({
    repo: "",
    tasks,
    ...groupingInputs(status),
    attention: [],
    gates: [],
    notes: [],
    now,
    limit: Number.MAX_SAFE_INTEGER,
  })
  return context.tasks.flatMap((row): TaskRow[] => {
    const task = byId.get(row.taskId)
    if (!task) return []
    const pr = rollupPr(task)
    const changes = rowChanges(extras?.changes ?? null, task.worktreePath)
    const tokens = rowTokenChips(extras?.tokens, task.id, now)
    const chip = prChipKind(task)
    const daemon = status?.tasks[task.id]
    return [
      {
        id: task.id,
        title: task.title,
        branch: task.branch,
        repo: task.repo,
        kind: task.kind ?? "task",
        status: task.status,
        group: row.group,
        rank: row.rank,
        activity: row.activity ? { ...row.activity, since: now - row.activity.forMs } : null,
        ...(daemon ? { rowStatus: daemon.task, tabStatus: daemon.tabs } : {}),
        engine: engineFor(task, engines),
        pr: pr
          ? {
              ...(pr.number !== undefined ? { number: pr.number } : {}),
              ...(pr.url ? { url: pr.url } : {}),
              lifecycle: pr.lifecycle,
              checkState: pr.checkState,
              ...(pr.reviewDecision ? { reviewDecision: pr.reviewDecision } : {}),
              ...(pr.mergeable ? { mergeable: pr.mergeable } : {}),
            }
          : null,
        report: task.report ? { summary: task.report.summary ?? "", at: task.report.at } : null,
        deleting: task.deletion?.phase === "queued" || task.deletion?.phase === "running",
        pinned: task.pinned === true,
        ...(task.routine ? { routine: true } : {}),
        order: orderOf.get(task.id) ?? 0,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        ...machineOf(task),
        ...(task.repoId ? { repoId: task.repoId } : {}),
        ...(task.extraRepos?.length ? { extraRepoCount: task.extraRepos.length } : {}),
        ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
        ...(task.sharesWorkspaceOf ? { sharesWorkspaceOf: task.sharesWorkspaceOf } : {}),
        ...(changes ? { changes } : {}),
        ...(tokens.length > 0 ? { rowTokens: tokens } : {}),
        prChip: chip,
        ...(task.prompt !== undefined ? { hasPrompt: true } : {}),
        prChipStale: chip !== null && pr?.lastError !== undefined,
        ...(task.worktreePath ? {} : { noWorktree: true as const }),
      },
    ]
  })
}

/** Untracked directories arrive as one row with children; the phone wants files. */
