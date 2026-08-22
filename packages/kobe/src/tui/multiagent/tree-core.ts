import type { Task } from "../../types/task"

export type AgentTreeAnomaly = "orphan" | "cycle"

interface AgentTreeBranch {
  /** One entry per ancestor level: true keeps that ancestor's vertical rail. */
  readonly ancestry: readonly boolean[]
  readonly isLast: boolean
  readonly depth: number
}

export interface AgentTreeTaskRow extends AgentTreeBranch {
  readonly kind: "task"
  readonly id: string
  readonly task: Task
  readonly role: "owner" | "agent"
  readonly anomaly?: AgentTreeAnomaly
}

export interface AgentTreeRoundRow extends AgentTreeBranch {
  readonly kind: "round"
  readonly id: string
  readonly groupId: string
  readonly tasks: readonly Task[]
}

export type AgentTreeRow = AgentTreeTaskRow | AgentTreeRoundRow

export interface AgentTreeSummary {
  readonly owners: number
  readonly agents: number
  readonly rounds: number
  readonly anomalies: number
}

export interface AgentTreeProjection {
  readonly rows: readonly AgentTreeRow[]
  readonly summary: AgentTreeSummary
}

type ChildEntry =
  | { readonly kind: "task"; readonly task: Task }
  | { readonly kind: "round"; readonly groupId: string; readonly tasks: readonly Task[] }

/** Keep daemon snapshot order while folding same-round siblings together. */
function childEntries(children: readonly Task[]): ChildEntry[] {
  const grouped = new Map<string, Task[]>()
  for (const child of children) {
    if (!child.groupId) continue
    const siblings = grouped.get(child.groupId) ?? []
    siblings.push(child)
    grouped.set(child.groupId, siblings)
  }

  const emittedGroups = new Set<string>()
  const entries: ChildEntry[] = []
  for (const child of children) {
    const groupId = child.groupId
    if (!groupId) {
      entries.push({ kind: "task", task: child })
      continue
    }
    if (emittedGroups.has(groupId)) continue
    emittedGroups.add(groupId)
    entries.push({ kind: "round", groupId, tasks: grouped.get(groupId) ?? [child] })
  }
  return entries
}

/**
 * Project durable Task provenance into a display-only forest.
 *
 * `dispatcher.taskId` is the parent edge; `groupId` inserts a visual round
 * between a dispatcher and the siblings it created together. Missing parents
 * and corrupt cycles become explicit roots, so malformed old state stays
 * inspectable instead of making the page recurse forever.
 */
export function buildAgentTree(tasks: readonly Task[]): AgentTreeProjection {
  const byId = new Map(tasks.map((task) => [String(task.id), task]))
  const children = new Map<string, Task[]>()

  for (const task of tasks) {
    const parentId = task.dispatcher?.taskId
    if (!parentId || parentId === task.id || !byId.has(parentId)) continue
    const rows = children.get(parentId) ?? []
    rows.push(task)
    children.set(parentId, rows)
  }

  const roots = tasks.filter((task) => {
    const parentId = task.dispatcher?.taskId
    return !parentId || parentId === task.id || !byId.has(parentId)
  })
  const rows: AgentTreeRow[] = []
  const visited = new Set<string>()

  function appendTask(
    task: Task,
    depth: number,
    ancestry: readonly boolean[],
    isLast: boolean,
    anomaly?: AgentTreeAnomaly,
  ): void {
    const id = String(task.id)
    if (visited.has(id)) return
    visited.add(id)
    rows.push({
      kind: "task",
      id: `task:${id}`,
      task,
      role: depth === 0 ? "owner" : "agent",
      depth,
      ancestry,
      isLast,
      ...(anomaly ? { anomaly } : {}),
    })

    const entries = childEntries(children.get(id) ?? [])
    const childAncestry = depth === 0 ? ancestry : [...ancestry, !isLast]
    entries.forEach((entry, entryIndex) => {
      const entryLast = entryIndex === entries.length - 1
      if (entry.kind === "task") {
        appendTask(entry.task, depth + 1, childAncestry, entryLast)
        return
      }

      rows.push({
        kind: "round",
        id: `round:${id}:${entry.groupId}`,
        groupId: entry.groupId,
        tasks: entry.tasks,
        depth: depth + 1,
        ancestry: childAncestry,
        isLast: entryLast,
      })
      entry.tasks.forEach((child, childIndex) => {
        appendTask(child, depth + 2, [...childAncestry, !entryLast], childIndex === entry.tasks.length - 1)
      })
    })
  }

  roots.forEach((task, index) => {
    const parentId = task.dispatcher?.taskId
    const anomaly = parentId ? (parentId === task.id ? "cycle" : "orphan") : undefined
    appendTask(task, 0, [], index === roots.length - 1, anomaly)
  })

  // A closed dispatcher cycle has no natural root. Seed each remaining
  // component once; appendTask's visited guard cuts its back-edge.
  for (const task of tasks) {
    if (!visited.has(String(task.id))) appendTask(task, 0, [], true, "cycle")
  }

  const taskRows = rows.filter((row): row is AgentTreeTaskRow => row.kind === "task")
  return {
    rows,
    summary: {
      owners: taskRows.filter((row) => row.role === "owner").length,
      agents: taskRows.filter((row) => row.role === "agent").length,
      rounds: rows.filter((row) => row.kind === "round").length,
      anomalies: taskRows.filter((row) => row.anomaly !== undefined).length,
    },
  }
}

/** Stable monospace branch prefix for task and round rows. */
export function agentTreePrefix(row: AgentTreeRow): string {
  if (row.depth === 0) return ""
  const ancestors = row.ancestry.map((continues) => (continues ? "│  " : "   ")).join("")
  return `${ancestors}${row.isLast ? "└─ " : "├─ "}`
}

export function shortGroupId(groupId: string): string {
  return groupId.length <= 8 ? groupId : groupId.slice(-8)
}
