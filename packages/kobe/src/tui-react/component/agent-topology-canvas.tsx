/** @jsxImportSource @opentui/react */

import { type BoxRenderable, type MouseEvent, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import type { TaskEngineState } from "../../client/remote-orchestrator"
import { engineEntry } from "../../engine/registry"
import type { Theme } from "../../tui/context/theme-core"
import { truncateEnd } from "../../tui/lib/truncate"
import {
  clipTopologyRaster,
  layoutAgentTopology,
  topologyEdgeCells,
  topologyEdgeRaster,
  topologyViewportOffset,
} from "../../tui/multiagent/topology-layout"
import type { AgentTopologyNode, AgentTopologyProjection } from "../../tui/multiagent/tree-core"
import { shortGroupId } from "../../tui/multiagent/tree-core"
import { DEFAULT_TASK_VENDOR, type Task } from "../../types/task"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"

type Tone = "primary" | "success" | "warning" | "error" | "muted"

function activityView(task: Task, activity: TaskEngineState | undefined): { glyph: string; key: string; tone: Tone } {
  if (task.archived) return { glyph: "·", key: "agents.state.archived", tone: "muted" }
  switch (activity?.state) {
    case "running":
      return { glyph: "◐", key: "agents.state.running", tone: "primary" }
    case "turn_complete":
      return { glyph: "●", key: "agents.state.complete", tone: "success" }
    case "permission_needed":
      return { glyph: "?", key: "agents.state.permission", tone: "warning" }
    case "rate_limited":
      return { glyph: "◷", key: "agents.state.rateLimited", tone: "warning" }
    case "error":
      return { glyph: "×", key: "agents.state.error", tone: "error" }
    default:
      return { glyph: "○", key: "agents.state.idle", tone: "muted" }
  }
}

function toneColor(theme: Theme, tone: Tone): Theme["primary"] {
  if (tone === "primary") return theme.primary
  if (tone === "success") return theme.success
  if (tone === "warning") return theme.warning
  if (tone === "error") return theme.error
  return theme.textMuted
}

function useCanvasViewport(): {
  body: BoxRenderable | null
  setBody: (value: BoxRenderable | null) => void
  viewport: { width: number; height: number }
  bump: () => void
} {
  const dims = useTerminalDimensions()
  const [body, setBody] = useState<BoxRenderable | null>(null)
  const [tick, setTick] = useState(0)
  const [viewport, setViewport] = useState({
    width: Math.max(40, dims.width - 32),
    height: Math.max(8, dims.height - 5),
  })
  const bump = useCallback(() => setTick((value) => (value + 1) & 0xff), [])

  useEffect(() => {
    void dims
    void tick
    if (!body || body.width <= 0 || body.height <= 0) return
    const next = { width: Math.max(20, body.width), height: Math.max(6, body.height) }
    setViewport((current) => (current.width === next.width && current.height === next.height ? current : next))
  }, [body, dims, tick])

  return { body, setBody, viewport, bump }
}

function nodeRoleKey(node: AgentTopologyNode): string {
  return node.anomaly ? `agents.${node.anomaly}` : `agents.${node.role}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function AgentTopologyCanvas(props: {
  projection: AgentTopologyProjection
  selectedId?: string
  engineStates?: ReadonlyMap<string, TaskEngineState>
  onSelect: (taskId: string) => void
}): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const { body, setBody, viewport, bump } = useCanvasViewport()
  const [hover, setHover] = useState<{ edgeId: string; x: number; y: number } | null>(null)
  const direction = viewport.width >= 82 ? "TB" : "LR"
  const nodeWidth = 28
  const layout = useMemo(
    () => layoutAgentTopology(props.projection, { direction, nodeWidth }),
    [props.projection, direction],
  )
  const offset = topologyViewportOffset(layout, props.selectedId, viewport)
  const spawnEdgeText = clipTopologyRaster(topologyEdgeRaster(layout, "spawn"), offset, viewport)
  const communicationEdges = useMemo(() => layout.edges.filter((edge) => edge.kind === "communication"), [layout.edges])
  const activeCommunicationIds = useMemo(
    () =>
      new Set(
        communicationEdges
          .filter((edge) => edge.from === props.selectedId || edge.to === props.selectedId)
          .map((edge) => edge.id),
      ),
    [communicationEdges, props.selectedId],
  )
  const communicationHitMap = useMemo(() => {
    const hitMap = new Map<string, string[]>()
    for (const edge of communicationEdges) {
      for (const point of topologyEdgeCells(edge, layout.direction)) {
        const key = `${point.x}:${point.y}`
        const ids = hitMap.get(key) ?? []
        if (!ids.includes(edge.id)) ids.push(edge.id)
        hitMap.set(key, ids)
      }
    }
    return hitMap
  }, [communicationEdges, layout.direction])
  const passiveCommunicationText = clipTopologyRaster(
    topologyEdgeRaster(
      { ...layout, edges: communicationEdges.filter((edge) => !activeCommunicationIds.has(edge.id)) },
      "communication",
    ),
    offset,
    viewport,
  )
  const activeCommunicationText = clipTopologyRaster(
    topologyEdgeRaster(
      { ...layout, edges: communicationEdges.filter((edge) => activeCommunicationIds.has(edge.id)) },
      "communication",
    ),
    offset,
    viewport,
  )
  const hoveredEdge = hover ? communicationEdges.find((edge) => edge.id === hover.edgeId) : undefined
  const hoveredFrom = hoveredEdge ? layout.nodes.find((node) => node.id === hoveredEdge.from) : undefined
  const hoveredTo = hoveredEdge ? layout.nodes.find((node) => node.id === hoveredEdge.to) : undefined
  const tooltipWidth = Math.min(64, Math.max(20, viewport.width))
  const tooltipHeight = 6
  const tooltipLeft = hover ? clamp(hover.x + 2, 0, Math.max(0, viewport.width - tooltipWidth)) : 0
  const tooltipTop = hover
    ? hover.y + tooltipHeight < viewport.height
      ? hover.y + 1
      : Math.max(0, hover.y - tooltipHeight)
    : 0

  function updateHover(event: MouseEvent): void {
    if (!body) return
    const x = event.x - body.x
    const y = event.y - body.y
    const edgeIds = communicationHitMap.get(`${x - offset.x}:${y - offset.y}`) ?? []
    const edge =
      edgeIds
        .map((id) => communicationEdges.find((candidate) => candidate.id === id))
        .find((candidate) => candidate?.firstMessagePreview && activeCommunicationIds.has(candidate.id)) ??
      edgeIds
        .map((id) => communicationEdges.find((candidate) => candidate.id === id))
        .find((candidate) => candidate?.firstMessagePreview)
    if (!edge) {
      setHover(null)
      return
    }
    setHover((current) =>
      current?.edgeId === edge.id && current.x === x && current.y === y ? current : { edgeId: edge.id, x, y },
    )
  }

  return (
    // biome-ignore lint/a11y/useKeyWithMouseEvents: terminal edge hover is pointer inspection; keyboard selection already exposes sender/receiver traffic in the footer.
    <box
      ref={(renderable: BoxRenderable | null) => setBody(renderable)}
      onSizeChange={bump}
      onMouseMove={updateHover}
      onMouseOut={() => setHover(null)}
      flexGrow={1}
      minHeight={0}
      overflow="hidden"
    >
      <box position="absolute" left={0} top={0} width={viewport.width} height={viewport.height} zIndex={2}>
        <text fg={theme.borderActive} wrapMode="none">
          {spawnEdgeText}
        </text>
      </box>
      <box position="absolute" left={0} top={0} width={viewport.width} height={viewport.height} zIndex={2}>
        <text fg={theme.info} attributes={TextAttributes.DIM} wrapMode="none">
          {passiveCommunicationText}
        </text>
      </box>
      <box position="absolute" left={0} top={0} width={viewport.width} height={viewport.height} zIndex={2}>
        <text fg={theme.info} attributes={TextAttributes.BOLD} wrapMode="none">
          {activeCommunicationText}
        </text>
      </box>

      {layout.batches.map((batch) => {
        const left = batch.x + offset.x
        const top = batch.y + offset.y
        return (
          <box
            key={batch.id}
            position="absolute"
            left={left}
            top={top}
            width={batch.width}
            height={batch.height}
            zIndex={1}
            border
            borderColor={theme.accent}
          />
        )
      })}

      {layout.batches.map((batch) => {
        const label = t("agents.batch", { id: shortGroupId(batch.groupId), count: batch.nodeIds.length })
        const labelWidth = [...label].length
        return (
          <box
            key={`${batch.id}:label`}
            position="absolute"
            left={batch.x + offset.x + Math.max(1, Math.floor((batch.width - labelWidth) / 2))}
            top={batch.y + offset.y + 1}
            width={labelWidth}
            height={1}
            zIndex={3}
            backgroundColor={theme.background}
          >
            <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none">
              {label}
            </text>
          </box>
        )
      })}

      {layout.nodes.map((node) => {
        const selected = node.id === props.selectedId
        const activity = activityView(node.task, props.engineStates?.get(node.id))
        const engine = engineEntry(node.task.vendor ?? DEFAULT_TASK_VENDOR)
        const engineName = engine.identity?.shortName ?? engine.displayName
        const role = t(nodeRoleKey(node))
        const meta = truncateEnd(`${role} · ${engineName} · ${t(activity.key)}`, node.width - 4)
        return (
          <box
            key={node.id}
            position="absolute"
            left={node.x + offset.x}
            top={node.y + offset.y}
            width={node.width}
            height={node.height}
            zIndex={3}
            border
            borderColor={selected ? theme.focusAccent : node.role === "root" ? theme.primary : theme.borderSubtle}
            backgroundColor={selected ? theme.backgroundElement : theme.backgroundPanel}
            paddingLeft={1}
            paddingRight={1}
            flexDirection="column"
            onMouseUp={() => props.onSelect(node.id)}
          >
            <box flexDirection="row" flexShrink={0}>
              <text fg={toneColor(theme, activity.tone)} wrapMode="none">
                {activity.glyph}
              </text>
              <text
                fg={theme.text}
                attributes={selected ? TextAttributes.BOLD : undefined}
                wrapMode="none"
                paddingLeft={1}
              >
                {truncateEnd(node.task.title, node.width - 5)}
              </text>
            </box>
            <text fg={node.anomaly ? theme.warning : theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
              {meta}
            </text>
          </box>
        )
      })}

      {hoveredEdge?.firstMessagePreview && hoveredFrom && hoveredTo && viewport.height >= tooltipHeight ? (
        <box
          position="absolute"
          left={tooltipLeft}
          top={tooltipTop}
          width={tooltipWidth}
          height={tooltipHeight}
          zIndex={10}
          border
          borderColor={theme.info}
          backgroundColor={theme.backgroundElement}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="column"
          overflow="hidden"
        >
          <text fg={theme.info} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
            {truncateEnd(
              t("agents.messagePreviewTitle", {
                from: hoveredFrom.task.title,
                to: hoveredTo.task.title,
              }),
              tooltipWidth - 4,
            )}
          </text>
          <text fg={theme.text} wrapMode="word" flexGrow={1}>
            {hoveredEdge.firstMessagePreview}
          </text>
        </box>
      ) : null}
    </box>
  )
}
