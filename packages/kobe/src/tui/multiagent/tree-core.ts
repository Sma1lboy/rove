import type { Task } from "../../types/task"

export type AgentTopologyAnomaly = "orphan" | "cycle"
export type AgentTopologyRole = "root" | "coordinator" | "agent"

export interface AgentTopologyNode {
  readonly id: string
  readonly task: Task
  readonly role: AgentTopologyRole
  readonly anomaly?: AgentTopologyAnomaly
}

export interface AgentTopologyEdge {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly kind: "spawn"
}

export interface AgentTopologyBatch {
  readonly id: string
  readonly groupId: string
  readonly nodeIds: readonly string[]
}

export interface AgentTopologyProjection {
  readonly nodes: readonly AgentTopologyNode[]
  readonly edges: readonly AgentTopologyEdge[]
  readonly batches: readonly AgentTopologyBatch[]
  readonly summary: {
    readonly agents: number
    readonly roots: number
    readonly coordinators: number
    readonly batches: number
    readonly anomalies: number
  }
}

/** Find every member of a closed dispatcher cycle in this functional graph. */
function cycleTaskIds(tasks: readonly Task[], byId: ReadonlyMap<string, Task>): ReadonlySet<string> {
  const cycles = new Set<string>()
  const settled = new Set<string>()

  for (const task of tasks) {
    const path: string[] = []
    const index = new Map<string, number>()
    let id: string | undefined = String(task.id)
    while (id && byId.has(id) && !settled.has(id)) {
      const seenAt = index.get(id)
      if (seenAt !== undefined) {
        for (const member of path.slice(seenAt)) cycles.add(member)
        break
      }
      index.set(id, path.length)
      path.push(id)
      id = byId.get(id)?.dispatcher?.taskId
    }
    for (const member of path) settled.add(member)
  }
  return cycles
}

/**
 * Project durable task provenance into graph data without inventing message
 * relationships. `dispatcher.taskId` is a directed spawn edge; `groupId` is
 * a batch enclosure over sibling nodes, never a fake intermediate task.
 */
export function buildAgentTopology(tasks: readonly Task[]): AgentTopologyProjection {
  const byId = new Map(tasks.map((task) => [String(task.id), task]))
  const cycleIds = cycleTaskIds(tasks, byId)
  const edges: AgentTopologyEdge[] = []
  const childCounts = new Map<string, number>()

  for (const task of tasks) {
    const id = String(task.id)
    const parentId = task.dispatcher?.taskId
    if (!parentId || parentId === id || !byId.has(parentId)) continue
    edges.push({ id: `spawn:${parentId}:${id}`, from: parentId, to: id, kind: "spawn" })
    childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1)
  }

  const batchesById = new Map<string, string[]>()
  for (const task of tasks) {
    if (!task.groupId) continue
    const members = batchesById.get(task.groupId) ?? []
    members.push(String(task.id))
    batchesById.set(task.groupId, members)
  }
  const batches = [...batchesById].map(([groupId, nodeIds]) => ({ id: `batch:${groupId}`, groupId, nodeIds }))

  const nodes = tasks.map((task): AgentTopologyNode => {
    const id = String(task.id)
    const parentId = task.dispatcher?.taskId
    const anomaly = cycleIds.has(id) ? "cycle" : parentId && !byId.has(parentId) ? "orphan" : undefined
    const hasValidParent = Boolean(parentId && parentId !== id && byId.has(parentId))
    const role: AgentTopologyRole = !hasValidParent ? "root" : childCounts.has(id) ? "coordinator" : "agent"
    return { id, task, role, ...(anomaly ? { anomaly } : {}) }
  })

  return {
    nodes,
    edges,
    batches,
    summary: {
      agents: nodes.length,
      roots: nodes.filter((node) => node.role === "root").length,
      coordinators: nodes.filter((node) => node.role === "coordinator").length,
      batches: batches.length,
      anomalies: nodes.filter((node) => node.anomaly !== undefined).length,
    },
  }
}

export function shortGroupId(groupId: string): string {
  return groupId.length <= 8 ? groupId : groupId.slice(-8)
}
