/**
 * The Dispatch page: the daemon's dispatch ledger drawn as a network. Senders (you, routines,
 * agent sessions) on the left, this machine's daemon hub in the middle, target sessions on the right,
 * another registered machine's inside its own frame (shown even with nothing dispatched to it); one
 * wire per pair, lit while a prompt is on it. Each prompt is a courier that runs its wire, then
 * knocks, works, asks or falls at the target as that engine reports. Settled prompts leave a
 * one-line history under the map. Click a node or a row to open that session.
 */

import "./dispatch.css"
import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { type CSSProperties, useEffect, useRef, useState } from "react"
import type { DispatchRow, TaskRow } from "rove-bridge/protocol"
import {
  COLUMN,
  type GraphNode,
  type Wire,
  graphOf,
  pointOn,
  senderOf,
  targetColumn,
  targetOf,
  wirePath,
} from "./dispatch-graph.ts"
import { FRAME_MS, moving, onMap, recent, runnerOf, settled } from "./dispatch.ts"
import { t, useLocale } from "./i18n/index.ts"
import { compactAge } from "./inbox.ts"
import { machineLabel, remoteLabel, useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { usePageFocus, usePageKeys } from "./pages-kit.ts"
import { useStore } from "./store.ts"
import { useTaskColor } from "./task-colors.ts"
import { page } from "./ui.ts"

const STATUS_GLYPH: Record<DispatchRow["status"], string> = {
  delivered: "→",
  working: "●",
  asking: "?",
  done: "✓",
  failed: "✗",
}

/** Settled rows that still draw their wire, so the map keeps who talks to whom. */
const MAP_SETTLED = 16
const ROW_H = COLUMN.row
const PAD = 18
const HUB_W = 212
const HUB_H = 60
/** The courier sprite box (3 cols × 3 rows of 12px mono) and how far it stands off a node. */
const SPRITE_W = 24
const SPRITE_H = 42
const STAND_OFF = 6

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Animation clock: every frame while a courier moves, once a second under reduced motion. */
function useClock(rows: readonly DispatchRow[]): number {
  const [now, setNow] = useState(Date.now)
  const live = moving(rows, Date.now())
  useEffect(() => {
    if (!live) return
    if (reducedMotion()) {
      const timer = window.setInterval(() => setNow(Date.now()), 1_000)
      return () => window.clearInterval(timer)
    }
    let raf = 0
    const tick = () => {
      setNow(Date.now())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [live])
  return now
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

export function DispatchView({ model }: { model: AppModel }) {
  const locale = useLocale()
  const root = usePageFocus()
  const snapshot = useStore(model.dispatches)
  const payload = useStore(model.tasks)
  const remote = useStore(model.remote)
  const machines = useMachines(model)
  const conn = useStore(model.client.conn)
  const rows = snapshot?.rows ?? []
  const now = useClock(rows)
  const [stageRef, width] = useWidth()
  const tasks = new Map([...(payload?.tasks ?? []), ...remote].map((task) => [task.id, task]))
  const words = (locale === "zh" ? tasksZh : tasksEn).machine

  usePageKeys((e) => {
    if (e.key === "Escape" || e.key === "q" || (e.ctrlKey && e.key === "c")) {
      page.set(null)
      return true
    }
    return false
  })

  const settledOnMap = new Set(rows.filter(settled).slice(-MAP_SETTLED))
  const mapRows = rows.filter((row) => !settled(row) || settledOnMap.has(row))
  const graph = graphOf(mapRows)
  const inFlight = rows.filter((row) => !settled(row)).length

  const nodeW = Math.round(Math.min(220, Math.max(112, width * 0.26)))
  const column = targetColumn(
    graph.targets,
    (node) => (node.taskId ? tasks.get(node.taskId)?.machine?.id : undefined),
    machines.map((m) => m.alias),
  )
  const height = Math.max(3 * ROW_H, graph.senders.length * ROW_H, column.height, HUB_H) + PAD * 2
  const centerY = (count: number, i: number) => (height - count * ROW_H) / 2 + i * ROW_H + ROW_H / 2
  const senderY = new Map(graph.senders.map((n, i) => [n.key, centerY(graph.senders.length, i)]))
  const columnTop = (height - column.height) / 2
  const targetY = (key: string) => columnTop + (column.y.get(key) ?? column.height / 2)
  const targetInset = (key: string) => (column.framed.has(key) ? COLUMN.pad : 0)
  const hubX = width / 2
  const hubY = height / 2
  const wireOf = (row: DispatchRow): Wire => ({
    from: { x: nodeW, y: senderY.get(senderOf(row).key) ?? hubY },
    hubIn: { x: hubX - HUB_W / 2, y: hubY },
    hubOut: { x: hubX + HUB_W / 2, y: hubY },
    to: { x: width - nodeW + targetInset(targetOf(row).key), y: targetY(targetOf(row).key) },
  })

  // One wire per sender→target pair; its tone is its liveliest prompt.
  const wires = new Map<string, { wire: Wire; tone: "live" | "failed" | "idle" }>()
  for (const row of mapRows) {
    const key = `${senderOf(row).key}>${targetOf(row).key}`
    const tone = !settled(row) ? "live" : row.status === "failed" && onMap(row, now) ? "failed" : "idle"
    const known = wires.get(key)
    if (!known || tone === "live" || (tone === "failed" && known.tone === "idle"))
      wires.set(key, { wire: wireOf(row), tone })
  }
  const lastTo = new Map<string, DispatchRow>()
  for (const row of mapRows) lastTo.set(targetOf(row).key, row)

  const open = (node: GraphNode) => {
    if (node.taskId) model.select(node.taskId, node.tabId)
  }
  const history = recent(rows)

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className="page dp-page" tabIndex={0} ref={root}>
      <div className="pg-top">
        <h1 className="page-title">{t("dispatch.title")}</h1>
        <span className="muted mono pg-hint">{t("dispatch.hint")}</span>
      </div>
      <div className={`dp-stage ${inFlight ? "is-live" : ""}`} ref={stageRef} style={{ height }}>
        {width > 0 && snapshot !== null ? (
          <>
            <svg className="dp-wires" width={width} height={height} aria-hidden="true">
              {[...wires.values()].map(({ wire, tone }) => (
                <path key={wirePath(wire)} d={wirePath(wire)} className={`dp-wire is-${tone}`} />
              ))}
            </svg>
            {graph.senders.map((node) => (
              <NodeBox
                key={node.key}
                node={node}
                task={node.taskId ? tasks.get(node.taskId) : undefined}
                style={{ left: 0, top: (senderY.get(node.key) ?? 0) - 18, width: nodeW }}
                onOpen={open}
              />
            ))}
            <div
              className="dp-hub mono"
              style={{ left: hubX - HUB_W / 2, top: hubY - HUB_H / 2, width: HUB_W, height: HUB_H }}
              title={conn.hello ? `${conn.hello.host} · v${conn.hello.roveVersion}` : undefined}
            >
              <span className="dp-hub-mark">
                <b>[</b> rove <b>]</b>
              </span>
              {conn.hello ? <span className="dp-hub-host">{conn.hello.host}</span> : null}
              <span className="dp-hub-sub">
                {inFlight ? t("dispatch.inFlightCount", { count: inFlight }) : t("dispatch.idle")}
              </span>
            </div>
            {column.frames.map((frame) => {
              const row = machines.find((m) => m.alias === frame.machine)
              const label = row ? machineLabel(row, words) : frame.machine
              return (
                <div
                  key={frame.machine}
                  className={`dp-machine ${row?.state === "online" ? "" : "is-stale"}`}
                  style={{ right: 0, top: columnTop + frame.top, width: nodeW, height: frame.height }}
                >
                  <span className="dp-machine-head mono" title={remoteLabel(frame.machine, row, words)}>
                    <span className="dp-machine-dot" aria-hidden="true" />
                    {label}
                  </span>
                </div>
              )
            })}
            {graph.targets.map((node) => (
              <NodeBox
                key={node.key}
                node={node}
                task={node.taskId ? tasks.get(node.taskId) : undefined}
                status={lastTo.get(node.key)?.status}
                style={{
                  right: targetInset(node.key),
                  top: targetY(node.key) - 18,
                  width: nodeW - targetInset(node.key) * 2,
                }}
                onOpen={open}
              />
            ))}
            {couriersOf(mapRows, now).map((row) => {
              const runner = runnerOf(row, now, Math.floor(now / FRAME_MS))
              const p = pointOn(wireOf(row), runner.x)
              // At the target it stands just off the node instead of on it.
              const x = runner.x >= 1 ? p.x - SPRITE_W - STAND_OFF : p.x - SPRITE_W / 2
              return (
                <span
                  key={row.id}
                  className={`dp-courier is-${runner.pose}`}
                  style={{ transform: `translate(${x}px, ${p.y - SPRITE_H + 6}px)` }}
                  title={row.promptHead}
                  aria-hidden="true"
                >
                  {runner.sprite.join("\n")}
                </span>
              )
            })}
            {mapRows.length === 0 ? <p className="dp-empty muted">{t("dispatch.emptyHint")}</p> : null}
          </>
        ) : null}
      </div>
      {history.length > 0 ? (
        <section className="dp-section">
          <h2 className="kicker">{t("dispatch.recent")}</h2>
          {history.map((row) => (
            <button
              type="button"
              key={row.id}
              className="dp-past"
              onClick={() => open(targetOf(row))}
              title={row.promptHead}
            >
              <span className={`dp-status mono is-${row.status}`}>{STATUS_GLYPH[row.status]}</span>
              <span className="dp-route mono">
                {endName(senderOf(row), tasks)} → {endName(targetOf(row), tasks)}
              </span>
              <span className="dp-prompt muted">
                {row.status === "failed" && row.reason ? `${row.reason} · ` : ""}
                {row.promptHead}
              </span>
              <span className="muted mono dp-age">{compactAge(now - row.statusAt)}</span>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  )
}

/** Couriers on the map. Arrived ones share a spot by their target, so only its newest stands there; the rest wait behind it. */
function couriersOf(rows: readonly DispatchRow[], now: number): DispatchRow[] {
  const standing = new Map<string, DispatchRow>()
  const out: DispatchRow[] = []
  for (const row of rows) {
    if (!onMap(row, now)) continue
    if (runnerOf(row, now, 0).x < 1) out.push(row)
    else standing.set(targetOf(row).key, row)
  }
  return [...out, ...standing.values()]
}

function endName(node: GraphNode, tasks: ReadonlyMap<string, TaskRow>): string {
  if (node.routine) return `⟳ ${node.routine}`
  if (!node.taskId) return t("dispatch.you")
  return tasks.get(node.taskId)?.title || node.taskId
}

function NodeBox({
  node,
  task,
  status,
  style,
  onOpen,
}: {
  node: GraphNode
  task: TaskRow | undefined
  status?: DispatchRow["status"]
  style: CSSProperties
  onOpen: (node: GraphNode) => void
}) {
  const ink = useTaskColor(node.taskId)
  const title = node.routine ? node.routine : node.taskId ? task?.title || node.taskId : t("dispatch.you")
  const sub = node.routine ? t("dispatch.routine") : node.taskId ? (node.tabId ?? "tab-1") : t("dispatch.owner")
  return (
    <button
      type="button"
      className={`dp-node ${node.taskId ? "" : "is-plain"} ${task?.machine?.stale ? "is-stale" : ""}`}
      style={{ ...style, ...(ink ? ({ "--node-ink": ink } as CSSProperties) : {}) }}
      onClick={() => onOpen(node)}
      disabled={!node.taskId}
      title={title}
    >
      <span className="dp-node-title">
        {node.routine ? "⟳ " : ""}
        {title}
      </span>
      <span className="dp-node-sub mono">
        {sub}
        {status ? <span className={`dp-status is-${status}`}> {STATUS_GLYPH[status]}</span> : null}
      </span>
    </button>
  )
}
