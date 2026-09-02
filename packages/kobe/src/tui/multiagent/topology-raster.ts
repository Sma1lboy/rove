/**
 * Rasterization of a placed topology into terminal cells: box-drawing
 * glyphs for routed edges, viewport panning, and clipping. Placement and
 * routing live in `topology-layout.ts`; the two halves share only the
 * layout shape.
 */
import type { TopologyDirection, TopologyLayout, TopologyLayoutEdge, TopologyPoint } from "./topology-layout"
import type { AgentTopologyEdge } from "./tree-core"

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

function glyph(mask: number, dashed: boolean): string {
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
  const solid = table[mask] ?? " "
  if (!dashed) return solid
  if (solid === "│") return "┆"
  if (solid === "─") return "┄"
  return solid
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

/** Every terminal cell occupied by one routed edge, including its endpoints. */
export function topologyEdgeCells(
  edge: Pick<TopologyLayoutEdge, "points">,
  direction: TopologyDirection,
): readonly TopologyPoint[] {
  const points = orthogonalPoints(edge.points, direction)
  const cells: TopologyPoint[] = []
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]
    if (!start) continue
    if (index === 0) cells.push(start)
    const end = points[index + 1]
    if (!end) continue
    const dx = Math.sign(end.x - start.x)
    const dy = Math.sign(end.y - start.y)
    let x = start.x
    let y = start.y
    while (x !== end.x || y !== end.y) {
      x += dx
      y += dy
      cells.push({ x, y })
    }
  }
  return cells
}

/** Rasterize routed spawn edges into a monochrome box-drawing canvas. */
export function topologyEdgeRaster(
  layout: TopologyLayout,
  kind: AgentTopologyEdge["kind"] = "spawn",
): readonly string[] {
  const cells = Array.from({ length: layout.height }, () => new Uint8Array(layout.width))
  const arrows = new Map<string, string>()
  const sources = new Set<string>()
  for (const edge of layout.edges.filter((candidate) => candidate.kind === kind)) {
    const points = orthogonalPoints(edge.points, layout.direction)
    for (let i = 1; i < points.length; i += 1) link(cells, points[i - 1]!, points[i]!)
    const start = points.at(0)
    if (kind === "communication" && start) sources.add(`${start.x}:${start.y}`)
    const end = points.at(-1)
    const before = points.at(-2)
    if (!end || !before) continue
    const dx = Math.sign(end.x - before.x)
    const dy = Math.sign(end.y - before.y)
    const mark =
      kind === "spawn"
        ? dx > 0
          ? "▶"
          : dx < 0
            ? "◀"
            : dy > 0
              ? "▼"
              : "▲"
        : dx > 0
          ? "▷"
          : dx < 0
            ? "◁"
            : dy > 0
              ? "▽"
              : "△"
    // `end` is already the cell immediately outside the destination card.
    // Marking the previous cell made the arrow float away from its target and
    // inverted the visual read on outer-loop routes.
    arrows.set(`${end.x}:${end.y}`, mark)
  }
  return cells.map((row, y) =>
    [...row]
      .map(
        (mask, x) =>
          arrows.get(`${x}:${y}`) ?? (sources.has(`${x}:${y}`) ? "◆" : glyph(mask, kind === "communication")),
      )
      .join(""),
  )
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
