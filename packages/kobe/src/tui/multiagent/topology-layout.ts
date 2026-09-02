import { graphlib, layout as runDagreLayout } from "@dagrejs/dagre"
import type { AgentTopologyBatch, AgentTopologyEdge, AgentTopologyNode, AgentTopologyProjection } from "./tree-core"

export type TopologyDirection = "TB" | "LR"

export interface TopologyLayoutNode extends AgentTopologyNode {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface TopologyLayoutEdge extends AgentTopologyEdge {
  readonly points: readonly TopologyPoint[]
}

export interface TopologyLayoutBatch extends AgentTopologyBatch {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface TopologyLayout {
  readonly direction: TopologyDirection
  readonly width: number
  readonly height: number
  readonly nodes: readonly TopologyLayoutNode[]
  readonly edges: readonly TopologyLayoutEdge[]
  readonly batches: readonly TopologyLayoutBatch[]
}

export interface TopologyPoint {
  readonly x: number
  readonly y: number
}

type TopologySide = "top" | "right" | "bottom" | "left"

interface CommunicationRoutePlan {
  readonly edge: AgentTopologyEdge
  readonly from: TopologyLayoutNode
  readonly to: TopologyLayoutNode
  readonly sourceSide: TopologySide
  readonly targetSide: TopologySide
  readonly lane: number
}

const DEFAULT_NODE_WIDTH = 28
const DEFAULT_NODE_HEIGHT = 4
const BATCH_PAD_X = 2
// Two rows keep the batch label visible above its first node card.
const BATCH_PAD_Y = 2

function routeEdge(from: TopologyLayoutNode, to: TopologyLayoutNode, direction: TopologyDirection): TopologyPoint[] {
  if (direction === "TB") {
    const downward = to.y >= from.y
    const start = {
      x: from.x + Math.floor(from.width / 2),
      y: downward ? from.y + from.height : from.y - 1,
    }
    const end = { x: to.x + Math.floor(to.width / 2), y: downward ? to.y - 1 : to.y + to.height }
    const middle = Math.round((start.y + end.y) / 2)
    return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end]
  }
  const rightward = to.x >= from.x
  const start = {
    x: rightward ? from.x + from.width : from.x - 1,
    y: from.y + Math.floor(from.height / 2),
  }
  const end = { x: rightward ? to.x - 1 : to.x + to.width, y: to.y + Math.floor(to.height / 2) }
  const middle = Math.round((start.x + end.x) / 2)
  return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end]
}

function communicationSides(
  from: TopologyLayoutNode,
  to: TopologyLayoutNode,
  direction: TopologyDirection,
  lane: number,
): readonly [TopologySide, TopologySide] {
  if (direction === "TB") {
    if (from.y === to.y) return to.x >= from.x ? ["right", "left"] : ["left", "right"]
    return lane % 2 === 0 ? ["right", "right"] : ["left", "left"]
  }
  if (from.x === to.x) return to.y >= from.y ? ["bottom", "top"] : ["top", "bottom"]
  return lane % 2 === 0 ? ["bottom", "bottom"] : ["top", "top"]
}

function portPoint(node: TopologyLayoutNode, side: TopologySide, ordinal: number, total: number): TopologyPoint {
  if (side === "left" || side === "right") {
    // Prefer the two content rows, then the border rows. Four incident edges
    // therefore get four visibly separate ports on one side of a standard card.
    const offsets = [1, node.height - 2, 0, node.height - 1]
    const y = node.y + (offsets[ordinal % offsets.length] ?? Math.floor(node.height / 2))
    return { x: side === "left" ? node.x - 1 : node.x + node.width, y }
  }
  const usable = Math.max(1, node.width - 2)
  const x = node.x + 1 + Math.round(((ordinal + 1) * (usable - 1)) / (total + 1))
  return { x, y: side === "top" ? node.y - 1 : node.y + node.height }
}

function routeCommunicationEdge(
  plan: CommunicationRoutePlan,
  start: TopologyPoint,
  end: TopologyPoint,
  direction: TopologyDirection,
): TopologyPoint[] {
  if (direction === "TB") {
    if (plan.sourceSide !== plan.targetSide) {
      const middle = Math.round((start.x + end.x) / 2)
      return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end]
    }
    const useRight = plan.sourceSide === "right"
    const band = Math.floor(plan.lane / 2)
    const outerX = useRight ? Math.max(start.x, end.x) + 3 + band * 2 : Math.min(start.x, end.x) - 3 - band * 2
    return [start, { x: outerX, y: start.y }, { x: outerX, y: end.y }, end]
  }
  if (plan.sourceSide !== plan.targetSide) {
    const middle = Math.round((start.y + end.y) / 2)
    return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end]
  }
  const useBottom = plan.sourceSide === "bottom"
  const band = Math.floor(plan.lane / 2)
  const outerY = useBottom ? Math.max(start.y, end.y) + 2 + band * 2 : Math.min(start.y, end.y) - 2 - band * 2
  return [start, { x: start.x, y: outerY }, { x: end.x, y: outerY }, end]
}

function layoutBatch(
  batch: AgentTopologyBatch,
  byId: ReadonlyMap<string, TopologyLayoutNode>,
): TopologyLayoutBatch | null {
  const nodes = batch.nodeIds.map((id) => byId.get(id)).filter((node): node is TopologyLayoutNode => node !== undefined)
  if (nodes.length === 0) return null
  const left = Math.min(...nodes.map((node) => node.x)) - BATCH_PAD_X
  const top = Math.min(...nodes.map((node) => node.y)) - BATCH_PAD_Y
  const right = Math.max(...nodes.map((node) => node.x + node.width)) + BATCH_PAD_X
  const bottom = Math.max(...nodes.map((node) => node.y + node.height)) + BATCH_PAD_Y
  return { ...batch, x: left, y: top, width: right - left, height: bottom - top }
}

/** Dagre owns stable rank/order placement; the terminal adapter keeps cell geometry integer-valued. */
export function layoutAgentTopology(
  projection: AgentTopologyProjection,
  options: { direction?: TopologyDirection; nodeWidth?: number; nodeHeight?: number } = {},
): TopologyLayout {
  const direction = options.direction ?? "TB"
  const nodeWidth = options.nodeWidth ?? DEFAULT_NODE_WIDTH
  const nodeHeight = options.nodeHeight ?? DEFAULT_NODE_HEIGHT
  const grouped = new Set(projection.batches.flatMap((batch) => batch.nodeIds))
  const graph = new graphlib.Graph()
    .setGraph({
      rankdir: direction,
      ranker: "network-simplex",
      acyclicer: "greedy",
      nodesep: direction === "TB" ? 7 : 3,
      edgesep: 2,
      ranksep: direction === "TB" ? 5 : 8,
      marginx: direction === "TB" ? 10 : 4,
      marginy: direction === "TB" ? 3 : 6,
    })
    .setDefaultEdgeLabel(() => ({}))

  for (const node of projection.nodes) {
    graph.setNode(node.id, {
      width: nodeWidth + (grouped.has(node.id) ? BATCH_PAD_X * 2 : 0),
      height: nodeHeight + (grouped.has(node.id) ? BATCH_PAD_Y * 2 : 0),
    })
  }
  for (const edge of projection.edges) {
    if (edge.kind === "spawn") graph.setEdge(edge.from, edge.to, { weight: 8, minlen: 1 })
  }
  runDagreLayout(graph)

  const nodes = projection.nodes.map((node): TopologyLayoutNode => {
    const placed = graph.node(node.id) as { x: number; y: number }
    return {
      ...node,
      x: Math.round(placed.x - nodeWidth / 2),
      y: Math.round(placed.y - nodeHeight / 2),
      width: nodeWidth,
      height: nodeHeight,
    }
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  let communicationLane = 0
  const communicationPlans = projection.edges.flatMap((edge): CommunicationRoutePlan[] => {
    if (edge.kind !== "communication") return []
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) return []
    const lane = communicationLane++ % 6
    const [sourceSide, targetSide] = communicationSides(from, to, direction, lane)
    return [{ edge, from, to, sourceSide, targetSide, lane }]
  })
  const portTotals = new Map<string, number>()
  for (const plan of communicationPlans) {
    for (const [node, side] of [
      [plan.from, plan.sourceSide],
      [plan.to, plan.targetSide],
    ] as const) {
      const key = `${node.id}:${side}`
      portTotals.set(key, (portTotals.get(key) ?? 0) + 1)
    }
  }
  const portOrdinals = new Map<string, number>()
  const communicationById = new Map(
    communicationPlans.map((plan): [string, TopologyLayoutEdge] => {
      const sourceKey = `${plan.from.id}:${plan.sourceSide}`
      const targetKey = `${plan.to.id}:${plan.targetSide}`
      const sourceOrdinal = portOrdinals.get(sourceKey) ?? 0
      const targetOrdinal = portOrdinals.get(targetKey) ?? 0
      portOrdinals.set(sourceKey, sourceOrdinal + 1)
      portOrdinals.set(targetKey, targetOrdinal + 1)
      const start = portPoint(plan.from, plan.sourceSide, sourceOrdinal, portTotals.get(sourceKey) ?? 1)
      const end = portPoint(plan.to, plan.targetSide, targetOrdinal, portTotals.get(targetKey) ?? 1)
      return [plan.edge.id, { ...plan.edge, points: routeCommunicationEdge(plan, start, end, direction) }]
    }),
  )
  const edges = projection.edges.flatMap((edge): TopologyLayoutEdge[] => {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) return []
    if (edge.kind === "communication") {
      const routed = communicationById.get(edge.id)
      return routed ? [routed] : []
    }
    return [{ ...edge, points: routeEdge(from, to, direction) }]
  })
  const batches = projection.batches.flatMap((batch): TopologyLayoutBatch[] => {
    const placed = layoutBatch(batch, byId)
    return placed ? [placed] : []
  })
  const right = Math.max(
    1,
    ...nodes.map((node) => node.x + node.width),
    ...batches.map((batch) => batch.x + batch.width),
    ...edges.flatMap((edge) => edge.points.map((point) => point.x + 1)),
  )
  const bottom = Math.max(
    1,
    ...nodes.map((node) => node.y + node.height),
    ...batches.map((batch) => batch.y + batch.height),
    ...edges.flatMap((edge) => edge.points.map((point) => point.y + 1)),
  )

  return { direction, width: right + 4, height: bottom + 3, nodes, edges, batches }
}
