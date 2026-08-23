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
      marginx: 4,
      marginy: 3,
    })
    .setDefaultEdgeLabel(() => ({}))

  for (const node of projection.nodes) {
    graph.setNode(node.id, {
      width: nodeWidth + (grouped.has(node.id) ? BATCH_PAD_X * 2 : 0),
      height: nodeHeight + (grouped.has(node.id) ? BATCH_PAD_Y * 2 : 0),
    })
  }
  for (const edge of projection.edges) graph.setEdge(edge.from, edge.to, { weight: 8, minlen: 1 })
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
  const edges = projection.edges.flatMap((edge): TopologyLayoutEdge[] => {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    return from && to ? [{ ...edge, points: routeEdge(from, to, direction) }] : []
  })
  const batches = projection.batches.flatMap((batch): TopologyLayoutBatch[] => {
    const placed = layoutBatch(batch, byId)
    return placed ? [placed] : []
  })
  const right = Math.max(
    1,
    ...nodes.map((node) => node.x + node.width),
    ...batches.map((batch) => batch.x + batch.width),
  )
  const bottom = Math.max(
    1,
    ...nodes.map((node) => node.y + node.height),
    ...batches.map((batch) => batch.y + batch.height),
  )

  return { direction, width: right + 4, height: bottom + 3, nodes, edges, batches }
}

const UP = 1
const RIGHT = 2
const DOWN = 4
const LEFT = 8

function link(cells: Uint8Array[], a: TopologyPoint, b: TopologyPoint): void {
  if (a.x === b.x && a.y === b.y) return
  const dx = Math.sign(b.x - a.x)
  const dy = Math.sign(b.y - a.y)
  let x = a.x
  let y = a.y
  while (x !== b.x || y !== b.y) {
    const nx = x + dx
    const ny = y + dy
    if (dx > 0) {
      cells[y]![x] |= RIGHT
      cells[ny]![nx] |= LEFT
    } else if (dx < 0) {
      cells[y]![x] |= LEFT
      cells[ny]![nx] |= RIGHT
    } else if (dy > 0) {
      cells[y]![x] |= DOWN
      cells[ny]![nx] |= UP
    } else {
      cells[y]![x] |= UP
      cells[ny]![nx] |= DOWN
    }
    x = nx
    y = ny
  }
}

function glyph(mask: number): string {
  const table: Record<number, string> = {
    [UP]: "│",
    [DOWN]: "│",
    [UP | DOWN]: "│",
    [LEFT]: "─",
    [RIGHT]: "─",
    [LEFT | RIGHT]: "─",
    [RIGHT | DOWN]: "┌",
    [LEFT | DOWN]: "┐",
    [RIGHT | UP]: "└",
    [LEFT | UP]: "┘",
    [UP | RIGHT | DOWN]: "├",
    [UP | LEFT | DOWN]: "┤",
    [LEFT | RIGHT | DOWN]: "┬",
    [LEFT | RIGHT | UP]: "┴",
    [UP | RIGHT | DOWN | LEFT]: "┼",
  }
  return table[mask] ?? " "
}

function orthogonalPoints(points: readonly TopologyPoint[], direction: TopologyDirection): TopologyPoint[] {
  const routed: TopologyPoint[] = []
  for (const point of points) {
    const previous = routed.at(-1)
    if (!previous) {
      routed.push(point)
      continue
    }
    if (previous.x !== point.x && previous.y !== point.y) {
      routed.push(direction === "TB" ? { x: point.x, y: previous.y } : { x: previous.x, y: point.y })
    }
    routed.push(point)
  }
  return routed.filter(
    (point, index) => index === 0 || point.x !== routed[index - 1]?.x || point.y !== routed[index - 1]?.y,
  )
}

/** Rasterize routed spawn edges into a monochrome box-drawing canvas. */
export function topologyEdgeRaster(layout: TopologyLayout): readonly string[] {
  const cells = Array.from({ length: layout.height }, () => new Uint8Array(layout.width))
  const arrows = new Map<string, string>()
  for (const edge of layout.edges) {
    const points = orthogonalPoints(edge.points, layout.direction)
    for (let i = 1; i < points.length; i += 1) link(cells, points[i - 1]!, points[i]!)
    const end = points.at(-1)
    const before = points.at(-2)
    if (!end || !before) continue
    const dx = Math.sign(end.x - before.x)
    const dy = Math.sign(end.y - before.y)
    const arrow = { x: end.x - dx, y: end.y - dy }
    const mark = dx > 0 ? "▶" : dx < 0 ? "◀" : dy > 0 ? "▼" : "▲"
    arrows.set(`${arrow.x}:${arrow.y}`, mark)
  }
  return cells.map((row, y) => [...row].map((mask, x) => arrows.get(`${x}:${y}`) ?? glyph(mask)).join(""))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Pan only when needed; otherwise center the whole topology in the viewport. */
export function topologyViewportOffset(
  layout: TopologyLayout,
  selectedId: string | undefined,
  viewport: { width: number; height: number },
): TopologyPoint {
  const selected = layout.nodes.find((node) => node.id === selectedId)
  const targetX = selected ? selected.x + Math.floor(selected.width / 2) : Math.floor(layout.width / 2)
  const targetY = selected ? selected.y + Math.floor(selected.height / 2) : Math.floor(layout.height / 2)
  const x =
    layout.width <= viewport.width
      ? Math.floor((viewport.width - layout.width) / 2)
      : clamp(Math.floor(viewport.width / 2) - targetX, viewport.width - layout.width, 0)
  const y =
    layout.height <= viewport.height
      ? Math.floor((viewport.height - layout.height) / 2)
      : clamp(Math.floor(viewport.height / 2) - targetY, viewport.height - layout.height, 0)
  return { x, y }
}

export function clipTopologyRaster(
  raster: readonly string[],
  offset: TopologyPoint,
  viewport: { width: number; height: number },
): string {
  const blank = " ".repeat(viewport.width)
  const rows: string[] = []
  for (let y = 0; y < viewport.height; y += 1) {
    const source = raster[y - offset.y]
    if (!source) {
      rows.push(blank)
      continue
    }
    const cells = [...source]
    const start = -offset.x
    let row = ""
    for (let x = 0; x < viewport.width; x += 1) row += cells[start + x] ?? " "
    rows.push(row)
  }
  return rows.join("\n")
}
