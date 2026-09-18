/**
 * The pure half of `context` — fold already-fetched daemon reads into the
 * coordinator's one-screen payload, and render it as text.
 *
 * Split from `handlers-context.ts` so the SHAPE is testable without a daemon:
 * that file owns the five RPCs, this one owns what a coordinator is charged
 * for on every single turn. Every field here has to survive the question
 * "would a coordinator act differently without it" — the ones that didn't
 * (worktreePath, vendor, groupId, the declared `status`, timestamps) are in
 * `get-task` and `collect`, one hop away.
 */

import { TASK_ACTIVITY_STATES, type TaskActivityState } from "@/engine/hook-events"
import { type TaskActivitySignal, type TaskGroup, taskGroupOf } from "@/lib/task-group"
import type { AttentionInboxItem } from "@sma1lboy/kobe-daemon/daemon/contracts"
import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"

/** Newest field notes carried. Matches `NOTE_INJECTION_CAP` — these are the
 *  ones a fresh session on this repo is already handed, so a coordinator
 *  reading a different set would brief its workers on facts they never see. */
export const CONTEXT_NOTE_CAP = 15

/** Default task cap. The verb is paid for on every coordinator turn; a repo
 *  with fifty stale attempts would spend thousands of tokens re-reading rows
 *  nobody is going to act on. Sorted by rank, so the cap drops the quiet
 *  tail, and `omittedTasks` says it happened. */
export const CONTEXT_TASK_LIMIT = 20

export interface ContextNote {
  readonly id: number
  readonly at: string
  readonly text: string
  readonly author: string
}

export interface ContextTask {
  readonly taskId: string
  readonly title: string
  readonly branch: string
  readonly group: TaskGroup
  readonly rank: number
  /** Engine state + how long it has been in it. `null` = could not read —
   *  which is also why the group may be `unknown`. */
  readonly activity: { readonly state: string; readonly forMs: number } | null
  /** Rove's OWN CI truth for the branch's PR. Absent when there is no PR. */
  readonly checkState?: string
  readonly pr?: number
  /** The worker's own claim. A claim, not a verification — see `collect`. */
  readonly report?: SerializedTask["report"]
}

export interface ContextPayload {
  readonly repo: string
  readonly at: string
  readonly tasks: readonly ContextTask[]
  /** Tasks the `--limit` dropped off the quiet end. */
  readonly omittedTasks?: number
  /** Unhandled attention episodes — what is queued for a person right now. */
  readonly attention: readonly AttentionInboxItem[]
  /** The repo's newest field notes: the same ones injected into fresh
   *  sessions here, so the coordinator briefs from what its workers read. */
  readonly notes: readonly ContextNote[]
}

/** One entry of the daemon activity registry's task dump (`debug.inspect`). */
export interface ActivityEntry {
  readonly state: string
  readonly at: number
}

export interface ContextInput {
  readonly repo: string
  /** Already filtered to the repo. */
  readonly tasks: readonly SerializedTask[]
  /** taskId → registry entry. An ABSENT key means the daemon has no reading,
   *  never that the task is idle. */
  readonly activity: Readonly<Record<string, ActivityEntry>> | null
  /** Task ids with a live hosted session, or `null` when the pty host could
   *  not be asked — which refutes nothing. */
  readonly liveTaskIds: ReadonlySet<string> | null
  readonly attention: readonly AttentionInboxItem[]
  readonly notes: readonly ContextNote[]
  readonly now: number
  readonly limit: number
}

/**
 * Compose the payload. Tasks are sorted by derived rank (what needs a person
 * NEXT first), ties broken by most-recent activity so a stale row cannot sit
 * above a fresh one in the same group.
 */
export function buildContext(input: ContextInput): ContextPayload {
  const rows: Array<ContextTask & { readonly at: number }> = []
  for (const task of input.tasks) {
    const entry = input.activity?.[task.id]
    // Wire-boundary check: `debug.inspect` types `state` as a bare string.
    // An unrecognised one is NOT a licence to invent a group — it goes to
    // the derivation as "nothing was read", which answers `unknown`.
    const activity: TaskActivitySignal | null =
      entry && (TASK_ACTIVITY_STATES as readonly string[]).includes(entry.state)
        ? { state: entry.state as TaskActivityState, at: entry.at }
        : null
    const { group, rank } = taskGroupOf({
      task,
      activity,
      tabAlive: input.liveTaskIds ? input.liveTaskIds.has(task.id) : null,
      now: input.now,
    })
    rows.push({
      taskId: task.id,
      title: task.title,
      branch: task.branch,
      group,
      rank,
      activity: activity ? { state: activity.state, forMs: Math.max(0, input.now - activity.at) } : null,
      ...(task.prStatus ? { checkState: task.prStatus.checkState } : {}),
      ...(task.prStatus?.number !== undefined ? { pr: task.prStatus.number } : {}),
      ...(task.report ? { report: task.report } : {}),
      at: activity?.at ?? 0,
    })
  }
  rows.sort((a, b) => a.rank - b.rank || b.at - a.at)
  const kept = rows.slice(0, input.limit).map(({ at: _at, ...row }) => row)
  const omitted = rows.length - kept.length
  return {
    repo: input.repo,
    at: new Date(input.now).toISOString(),
    tasks: kept,
    ...(omitted > 0 ? { omittedTasks: omitted } : {}),
    attention: input.attention,
    notes: input.notes.slice(0, CONTEXT_NOTE_CAP),
  }
}

/** `4m` / `2h` / `3d` — coarse on purpose; a coordinator acts on the order of
 *  magnitude, not the seconds. */
function age(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`
}

/** Short task-id tail — enough to name a row to a human, and every verb
 *  still needs the full id from the JSON. */
function shortId(id: string): string {
  return id.slice(-6)
}

/**
 * Compact text rendering (`--text`). One line per task in rank order, so the
 * first line is what needs a person next.
 */
export function renderContext(payload: ContextPayload): string {
  const lines = [`repo ${payload.repo} · ${payload.tasks.length} tasks · ${payload.attention.length} in the inbox`]
  if (payload.tasks.length === 0) lines.push("  (no tasks)")
  for (const task of payload.tasks) {
    const bits: string[] = []
    if (task.activity) bits.push(`${task.activity.state} ${age(task.activity.forMs)}`)
    if (task.checkState) bits.push(`ci:${task.checkState}`)
    if (task.pr !== undefined) bits.push(`PR#${task.pr}`)
    if (task.report?.summary) bits.push(`“${task.report.summary}”`)
    else if (task.report) bits.push("reported")
    lines.push(
      `  ${task.group.padEnd(16)} ${shortId(task.taskId)}  ${task.title}${task.branch ? ` [${task.branch}]` : ""}${
        bits.length > 0 ? ` — ${bits.join(" · ")}` : ""
      }`,
    )
  }
  if (payload.omittedTasks) lines.push(`  (+${payload.omittedTasks} quieter tasks not shown — raise --limit)`)
  if (payload.attention.length > 0) {
    lines.push(`inbox (${payload.attention.length} unhandled):`)
    for (const item of payload.attention)
      lines.push(`  ${item.state}  ${item.taskId ? shortId(item.taskId) : "routine"}`)
  }
  if (payload.notes.length > 0) {
    lines.push(`field notes (${payload.notes.length}, newest first):`)
    for (const note of payload.notes) lines.push(`  #${note.id} ${note.text}`)
  }
  return lines.join("\n")
}
