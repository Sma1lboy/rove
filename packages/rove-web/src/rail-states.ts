/**
 * The by-state rail (Settings → Appearance → Task list): one list across every project, under the headers
 * needs you / working / ready / idle. A top-level task takes the most urgent state anywhere in its subtree,
 * so a parent whose child waits on a person surfaces with it, and its children stay nested under it. The
 * attempts of one compare round share the most urgent state of the round, so the round stays one block.
 */
import type { TaskRow } from "rove-bridge/protocol"
import { t } from "./i18n/index.ts"
import { repoLabel } from "./rail-labels.ts"
import { roundKey, roundsAmong } from "./rail-rounds.ts"
import {
  type NavRow,
  type ProjectGroup,
  type RailInput,
  indexChildren,
  isNoProject,
  navRows,
  orderTasks,
} from "./rail.ts"

/** Most urgent first. */
export const RAIL_STATES = ["needs", "working", "ready", "idle"] as const
export type RailState = (typeof RAIL_STATES)[number]

const KEY_PREFIX = "~state:"

/**
 * What a task needs from a person, read as its row's mark reads: a prompt, a failure or an unread finished
 * turn is `needs`; a running engine is `working`. A task with no live signal falls to the daemon's own
 * group (`task.group`) and then its PR: one open, or work marked done, is `ready`.
 */
export function stateOf(task: TaskRow): RailState {
  switch (task.rowStatus?.kind) {
    case "attention":
    case "needs-input":
    case "unseen":
      return "needs"
    case "busy":
    case "running":
      return "working"
  }
  switch (task.group) {
    case "waiting-on-you":
      return "needs"
    case "working":
      return "working"
    case "landing":
    case "ready-for-review":
      return "ready"
  }
  return task.pr?.lifecycle === "open" || task.status === "done" ? "ready" : "idle"
}

/** The project a top-level row of the by-state list names, since it has no project header; a main row is the project's own name. */
export const rowRepo = (task: TaskRow | undefined): string | undefined =>
  task && task.kind !== "main" && !isNoProject(task) ? repoLabel(task.repo) : undefined

/** `tasks` split into one group per non-empty state, each task with its whole top-level block (see the file head). */
function stateGroups(tasks: readonly TaskRow[], input: RailInput): ProjectGroup[] {
  const ordered = orderTasks(tasks, input.sort)
  const { children, nested } = indexChildren([{ repo: "", label: "", tasks: ordered }])
  const roots = ordered.filter((task) => !nested.has(task.id))
  const rounds = roundsAmong(roots)
  const subtree = (root: TaskRow): TaskRow[] => {
    const out: TaskRow[] = []
    const seen = new Set<string>()
    const walk = (task: TaskRow): void => {
      if (seen.has(task.id)) return
      seen.add(task.id)
      out.push(task)
      for (const child of children.get(task.id) ?? []) walk(child)
    }
    walk(root)
    return out
  }
  const bucketOf = new Map<string, RailState>()
  for (const root of roots) {
    const key = roundKey(root)
    const unit = (key === null ? undefined : rounds.get(key)) ?? [root]
    const blocks = unit.map(subtree)
    const best = blocks
      .flat()
      .map(stateOf)
      .reduce((a, b) => (RAIL_STATES.indexOf(b) < RAIL_STATES.indexOf(a) ? b : a))
    for (const block of blocks) for (const task of block) bucketOf.set(task.id, best)
  }
  return RAIL_STATES.flatMap((state): ProjectGroup[] => {
    const rows = ordered.filter((task) => bucketOf.get(task.id) === state)
    return rows.length === 0
      ? []
      : [{ repo: "", label: t(`rail.state.${state}`), key: `${KEY_PREFIX}${state}`, tasks: rows }]
  })
}

/** {@link railRows} for the by-state list: every project's rows (this machine's and each registered machine's) under state headers. */
export function railStateRows(input: RailInput): { rows: NavRow[]; groups: ProjectGroup[] } {
  const known = new Set(input.machines.map((machine) => machine.alias))
  const tasks = [
    ...input.tasks.filter((task) => !task.routine),
    ...input.remote.filter((task) => !task.routine && task.machine !== undefined && known.has(task.machine.id)),
  ]
  const listed = navRows(stateGroups(tasks, input), input.query, input.fold)
  const counts = new Map<string, number>()
  let head = ""
  for (const row of listed) {
    if (row.kind === "project") head = row.id
    else if (row.kind === "task") counts.set(head, (counts.get(head) ?? 0) + 1)
  }
  const rows = listed.map((row): NavRow => {
    if (row.kind !== "project") return row
    const state = row.id.slice(`project:${KEY_PREFIX}`.length) as RailState
    return { id: `state:${state}`, kind: "state", state, label: row.label, count: counts.get(row.id) ?? 0 }
  })
  return { rows, groups: [] }
}
