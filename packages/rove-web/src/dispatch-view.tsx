/**
 * The Dispatch page: the daemon's dispatch ledger drawn as a network. Senders (you, routines,
 * agent sessions) on the left, this machine's daemon hub in the middle, target sessions on the right,
 * another registered machine's inside its own frame (shown even with nothing dispatched to it); one
 * wire per pair, lit while a prompt is on it. A prompt in flight is one small glyph riding its wire;
 * once it lands, its state shows on the target node: delivered, working, asking, done or failed. A
 * prompt that failed before it arrived leaves a mark where it stopped. Settled prompts leave a
 * one-line history under the map. Click a node or a row to open that session.
 */

import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { type CSSProperties, useEffect, useRef, useState } from "react"
import type { DispatchRow, TabRow, TaskRow } from "rove-bridge/protocol"
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
import { flightOf, moving, recent, settled, statusByTarget, stoppedAt } from "./dispatch.ts"
import { t, useLocale } from "./i18n/index.ts"
import { compactAge } from "./inbox.ts"
import { deviceHint } from "./key-hints.ts"
import { machineLabel, remoteLabel, useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { usePageFocus, usePageKeys } from "./pages-kit.ts"
import { tabLabel } from "./rail.ts"
import { useStore } from "./store.ts"
import { page } from "./ui.ts"
import * as dp from "./ui/dispatch.ts"
import { Legend } from "./ui/legend.tsx"
import { PAGE_SCROLL, PAGE_TITLE, PG_TOP, pgHintClass } from "./ui/page.ts"
import { KICKER } from "./ui/text.ts"

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
const PAD = 24
const HUB_W = 232
const HUB_MIN_W = 96
/** Room for a wire between a column and the hub. */
const HUB_GAP = 16
const HUB_H = 72
/** Matches the node's `h-10.5` in ui/dispatch.ts. */
const NODE_H = 42
/** Widest the sender-hub-target band gets; past it the page's sides are margin. */
const BAND_MAX = 1080

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Clock: every frame while a prompt travels its wire (never under reduced motion), else once a second so the history's ages stay true. */
function useClock(rows: readonly DispatchRow[]): number {
  const [now, setNow] = useState(Date.now)
  const flying = !reducedMotion() && moving(rows, Date.now())
  const aging = rows.length > 0
  useEffect(() => {
    if (!aging) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [aging])
  useEffect(() => {
    if (!flying) return
    let raf = 0
    const tick = () => {
      setNow(Date.now())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [flying])
  return now
}

function useSize(): [React.RefObject<HTMLDivElement | null>, number, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry?.contentRect.width ?? 0, height: entry?.contentRect.height ?? 0 }),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size.width, size.height]
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
  const [stageRef, width, stageH] = useSize()
  const tasks = new Map([...(payload?.tasks ?? []), ...remote].map((task) => [task.id, task]))
  const words = (locale === "zh" ? tasksZh : tasksEn).machine
  const allTabs = useStore(model.tabs)
  const tabOf = (node: GraphNode) =>
    node.taskId ? allTabs[node.taskId]?.find((tab) => tab.id === (node.tabId ?? "tab-1")) : undefined

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
  const still = reducedMotion()

  // The graph keeps to a centred band, so a wide window doesn't strand the columns at its edges.
  const band = Math.min(width, BAND_MAX)
  const edge = (width - band) / 2
  // A phone's band can't hold two 128px columns beside a 232px hub: the three share it, the hub shrinking first.
  const nodeW = Math.round(Math.min(260, Math.max(128, band * 0.26), (band - HUB_MIN_W - 2 * HUB_GAP) / 2))
  const hubW = Math.max(HUB_MIN_W, Math.min(HUB_W, band - 2 * nodeW - 2 * HUB_GAP))
  const column = targetColumn(
    graph.targets,
    (node) => (node.taskId ? tasks.get(node.taskId)?.machine?.id : undefined),
    machines.map((m) => m.alias),
  )
  const needed = Math.max(3 * ROW_H, graph.senders.length * ROW_H, column.height, HUB_H) + PAD * 2
  const height = Math.max(needed, stageH)
  const centerY = (count: number, i: number) => (height - count * ROW_H) / 2 + i * ROW_H + ROW_H / 2
  const senderY = new Map(graph.senders.map((n, i) => [n.key, centerY(graph.senders.length, i)]))
  const columnTop = (height - column.height) / 2
  const targetY = (key: string) => columnTop + (column.y.get(key) ?? column.height / 2)
  const targetInset = (key: string) => (column.framed.has(key) ? COLUMN.pad : 0)
  const hubX = width / 2
  const hubY = height / 2
  const wireOf = (row: DispatchRow): Wire => ({
    from: { x: edge + nodeW, y: senderY.get(senderOf(row).key) ?? hubY },
    hubIn: { x: hubX - hubW / 2, y: hubY },
    hubOut: { x: hubX + hubW / 2, y: hubY },
    to: { x: width - edge - nodeW + targetInset(targetOf(row).key), y: targetY(targetOf(row).key) },
  })

  // One wire per sender→target pair, from its newest prompt: lit while one travels it, red where one stopped short.
  const flying = (row: DispatchRow) => (still ? null : flightOf(row, now))
  const wires = new Map<string, { wire: Wire; tone: "live" | "failed" | "idle"; row: DispatchRow }>()
  for (const row of mapRows) {
    const key = `${senderOf(row).key}>${targetOf(row).key}`
    const tone = flying(row) !== null ? "live" : stoppedAt(row) !== null ? "failed" : "idle"
    if (tone === "live" || wires.get(key)?.tone !== "live") wires.set(key, { wire: wireOf(row), tone, row })
  }
  const statuses = statusByTarget(mapRows, (row) => targetOf(row).key)

  const open = (node: GraphNode) => {
    if (node.taskId) model.select(node.taskId, node.tabId)
  }
  const history = recent(rows)

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
    <div className={`${PAGE_SCROLL} ${dp.DP_PAGE}`} tabIndex={0} ref={root}>
      <div className={PG_TOP}>
        <h1 className={PAGE_TITLE}>{t("dispatch.title")}</h1>
        <span className={`mono touch:empty:hidden! text-muted ${pgHintClass(true)}`}>
          <Legend text={deviceHint(t("dispatch.hint"))} />
        </span>
      </div>
      <div className={dp.DP_STAGE} ref={stageRef} style={{ minHeight: needed }}>
        {width > 0 && snapshot !== null ? (
          <>
            <svg className={dp.DP_WIRES} width={width} height={height} aria-hidden="true">
              {[...wires.values()].map(({ wire, tone }) => (
                <g key={wirePath(wire)}>
                  <path d={wirePath(wire)} className={dp.wireClass(tone)} />
                  <circle cx={wire.from.x} cy={wire.from.y} r={2} className={dp.portClass(tone)} />
                  <circle cx={wire.to.x} cy={wire.to.y} r={2} className={dp.portClass(tone)} />
                </g>
              ))}
            </svg>
            {graph.senders.map((node) => (
              <NodeBox
                key={node.key}
                node={node}
                task={node.taskId ? tasks.get(node.taskId) : undefined}
                tab={tabOf(node)}
                side="sender"
                style={{ left: edge, top: (senderY.get(node.key) ?? 0) - NODE_H / 2, width: nodeW }}
                onOpen={open}
              />
            ))}
            <div
              className={`mono ${dp.hubClass}`}
              style={{ left: hubX - hubW / 2, top: hubY - HUB_H / 2, width: hubW, height: HUB_H }}
              title={conn.hello ? `${conn.hello.host} v${conn.hello.roveVersion}` : undefined}
            >
              <span className={dp.HUB_MARK}>
                <b>[</b> rove <b>]</b>
              </span>
              {conn.hello ? <span className={dp.HUB_HOST}>{conn.hello.host}</span> : null}
              <span className={dp.hubSubClass(inFlight > 0)}>
                {inFlight ? t("dispatch.openCount", { count: inFlight }) : t("dispatch.idle")}
              </span>
            </div>
            {column.frames.map((frame) => {
              const row = machines.find((m) => m.alias === frame.machine)
              const label = row ? machineLabel(row, words) : frame.machine
              return (
                <div
                  key={frame.machine}
                  className={dp.DP_MACHINE}
                  style={{ right: edge, top: columnTop + frame.top, width: nodeW, height: frame.height }}
                >
                  <span
                    className={`mono ${dp.machineHeadClass(row?.state !== "online")}`}
                    title={remoteLabel(frame.machine, row, words)}
                  >
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
                tab={tabOf(node)}
                side="target"
                status={statuses.get(node.key)}
                style={{
                  right: edge + targetInset(node.key),
                  top: targetY(node.key) - NODE_H / 2,
                  width: nodeW - targetInset(node.key) * 2,
                }}
                onOpen={open}
              />
            ))}
            {mapRows.flatMap((row) => {
              const at = flying(row)
              if (at === null) return []
              const p = pointOn(wireOf(row), at)
              return [
                <span
                  key={row.id}
                  className={dp.FLIGHT}
                  style={{ transform: `translate(${p.x - 6}px, ${p.y - 6}px)` }}
                  title={row.promptHead}
                  aria-hidden="true"
                >
                  ●
                </span>,
              ]
            })}
            {[...wires.values()].flatMap(({ row, tone }) => {
              const at = tone === "failed" ? stoppedAt(row) : null
              if (at === null) return []
              const p = pointOn(wireOf(row), at)
              return [
                <span
                  key={row.id}
                  className={dp.STOPPED}
                  style={{ transform: `translate(${p.x + 4}px, ${p.y - 16}px)` }}
                  title={row.reason ? `${row.reason}: ${row.promptHead}` : row.promptHead}
                  aria-hidden="true"
                >
                  ✗
                </span>,
              ]
            })}
            {mapRows.length === 0 ? (
              <p className={`text-muted ${dp.DP_EMPTY}`} style={{ top: hubY + HUB_H / 2 + 10 }}>
                {t("dispatch.emptyHint")}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
      {history.length > 0 ? (
        <section className={dp.DP_SECTION}>
          <h2 className={`${KICKER} text-muted ${dp.DP_KICKER}`}>{t("dispatch.recent")}</h2>
          {history.map((row) => (
            <button
              type="button"
              key={row.id}
              className={dp.DP_PAST}
              onClick={() => open(targetOf(row))}
              title={row.promptHead}
            >
              <span className={`mono ${dp.statusClass(row.status)}`}>{STATUS_GLYPH[row.status]}</span>
              <span className={`mono ${dp.DP_ROUTE}`}>
                {endName(senderOf(row), tasks)} → {endName(targetOf(row), tasks)}
              </span>
              <span className={`text-muted ${dp.DP_PROMPT}`}>
                {row.status === "failed" && row.reason ? `${row.reason}: ` : ""}
                {row.promptHead}
              </span>
              <span className={`mono text-muted ${dp.DP_AGE}`}>{compactAge(now - row.statusAt)}</span>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  )
}

function endName(node: GraphNode, tasks: ReadonlyMap<string, TaskRow>): string {
  if (node.routine) return `⟳ ${node.routine}`
  if (!node.taskId) return t("dispatch.you")
  return tasks.get(node.taskId)?.title || node.taskId
}

function NodeBox({
  node,
  task,
  tab,
  side,
  status,
  style,
  onOpen,
}: {
  node: GraphNode
  task: TaskRow | undefined
  tab?: TabRow
  side: "sender" | "target"
  status?: DispatchRow["status"]
  style: CSSProperties
  onOpen: (node: GraphNode) => void
}) {
  const title = node.routine ? node.routine : node.taskId ? task?.title || node.taskId : t("dispatch.you")
  // A session reads as the rail names its tab; the owner and a routine need no second line.
  const sub = node.taskId ? (tab ? tabLabel(tab) : (node.tabId ?? "tab-1")) : null
  return (
    <button
      type="button"
      className={dp.nodeClass({ plain: !node.taskId, side, asking: status === "asking" })}
      style={style}
      onClick={() => onOpen(node)}
      disabled={!node.taskId}
      title={title}
    >
      <span className={dp.nodeTitleClass(!!task?.machine?.stale)}>
        {node.routine ? "⟳ " : ""}
        {title}
      </span>
      {sub !== null || status ? (
        <span className={dp.NODE_SUB}>
          <span className={dp.NODE_SUB_LABEL}>{sub}</span>
          {status ? (
            <span className={`mono shrink-0 ${dp.statusClass(status)}`}>
              {STATUS_GLYPH[status]} {t(`dispatch.status.${status}`)}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  )
}
