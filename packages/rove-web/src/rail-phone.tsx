/** The session list as a phone draws it: two-line rows with a status mark, group headers with a count and ⋯, and the line under the wordmark. */

import { useEffect, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { openPage } from "./layout.ts"
import { CloudMark } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { useCopy, useReload } from "./pages-kit.ts"
import { extPages, sessionAge, sessionLine2 } from "./phone-rows.ts"
import { PrChip } from "./pr-chip.tsx"
import { usePrefs } from "./prefs.ts"
import type { RailRowProps } from "./rail-view.tsx"
import type { NavRow } from "./rail.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { type RoutinesReply, routineNeedsYou } from "./routines-data.ts"
import { useStore } from "./store.ts"
import { ExtensionsButton, PhoneGroupHead, PhoneStatusRow, RoutinesButton, StatusGlyph } from "./ui/phone-rows.tsx"
import { CHILD_INDENT, guideClass, projectHead } from "./ui/rail.ts"
import { SwipeRow } from "./ui/swipe-row.tsx"

/** Until the bridge's glyph sets arrive: its default set's marks. */
const GLYPHS = {
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  idle: "○",
  unseen: "●",
  needsInput: "?",
  attention: "!",
}

export function PhoneRailRow(props: RailRowProps) {
  const { row } = props
  const { prefs, glyphSets } = usePrefs()
  if (row.kind === "project" || row.kind === "state") {
    // Another machine's project has no checkout here, so no actions of its own.
    const hasMenu = row.kind === "project" && row.machine === undefined
    return (
      <h2
        className={`${projectHead({ moving: props.moving, dragging: false, grab: false })} narrow:mb-0`}
        onContextMenu={props.onMenu}
        {...props.place}
      >
        <PhoneGroupHead
          label={row.label}
          count={row.kind === "state" ? row.count : (props.count ?? 0)}
          collapsed={!!props.collapsed}
          foldLabel={t(props.collapsed ? "rail.expandGroup" : "rail.collapseGroup", { name: row.label })}
          onToggle={props.onClick}
          more={hasMenu ? { label: t("rail.groupActions", { name: row.label }), onClick: props.onMenu } : undefined}
        />
      </h2>
    )
  }
  const task = row.task
  const line = sessionLine2(task)
  const button = (
    <PhoneStatusRow
      lead={
        props.guides && (
          <span className={CHILD_INDENT} aria-hidden="true">
            {props.guides.map((guide, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a column's place is its identity
              <span key={i} className={guideClass(guide)} />
            ))}
          </span>
        )
      }
      mark={
        <StatusGlyph
          status={row.fold?.collapsed ? props.rollup : task.rowStatus}
          glyphs={glyphSets[prefs.glyphSet] ?? GLYPHS}
        />
      }
      title={row.attempt ?? task.label}
      dim={props.stale}
      selected={props.selected}
      line2={
        <>
          {props.repo && <span className="max-w-24 flex-none truncate text-subtle">{props.repo}</span>}
          <span className="min-w-0 truncate">{line.branch}</span>
          {line.behind && <span className="flex-none tabular-nums">{line.behind}</span>}
          {row.fold?.collapsed && <span className="flex-none text-subtle">+{row.fold.count}</span>}
          {task.pinned && <span className="flex-none text-subtle">▴</span>}
          <PrChip tasks={props.prTasks ?? [task]} />
          {props.cloud && <CloudMark label={props.cloud} />}
        </>
      }
      top={sessionAge(task, Date.now())}
      bottom={task.engine?.name}
      onClick={props.onClick}
      onContextMenu={props.onMenu}
      {...props.place}
    />
  )
  return props.swipe ? (
    <SwipeRow left={props.swipe.left} right={props.swipe.right} ground="paper">
      {button}
    </SwipeRow>
  ) : (
    button
  )
}

/** Under the wordmark: which computer this is, whether the page reaches it, and how many tasks it lists. */
export function PhoneRailNote({ model, count }: { model: AppModel; count: number }) {
  useLocale()
  const conn = useStore(model.client.conn)
  const state =
    conn.state === "open"
      ? t("rail.connected")
      : t(conn.state === "retrying" ? "rail.reconnecting" : "status.connecting")
  return (
    <p className="m-0 truncate px-4 pb-2 font-sans text-meta text-muted" data-rail-note>
      {[conn.hello?.host, state, t(count === 1 ? "rail.taskCount" : "rail.tasksCount", { count })]
        .filter(Boolean)
        .join(" · ")}
    </p>
  )
}

/** A routine's last run can change with no task changing, so the count is read again this often. */
const ROUTINES_POLL_MS = 30_000

/** Top right of the list, left of Extensions: Routines, with how many need you. */
export function PhoneRoutines({ model }: { model: AppModel }) {
  const { nav } = useCopy()
  const c = model.client
  const [tick] = useReload(ROUTINES_POLL_MS)
  const [reply, setReply] = useState(() => lastReply<RoutinesReply>(c, "routine.list") ?? null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a trigger the body doesn't read
  useEffect(() => {
    let live = true
    const read = () =>
      requestRemembered<RoutinesReply>(c, "routine.list")
        .then((res) => live && setReply(res))
        .catch(() => {})
    // Runs now when the socket is up, and on every (re)connect: the list mounts before it is.
    const off = c.onOpen(read)
    return () => {
      live = false
      off()
    }
  }, [c, tick])
  const count = (reply?.automations ?? []).filter((routine) => routineNeedsYou(reply, routine.id)).length
  return <RoutinesButton label={nav.automations} count={count} onClick={() => openPage("routines")} />
}

/** Top right of the list: the pages extensions add. Hidden while none is installed. */
export function PhoneExtensions({ model }: { model: AppModel }) {
  const { nav } = useCopy()
  const pages = extPages(useStore(model.installedMods), useStore(model.mods), nav)
  if (pages.length === 0) return null
  return <ExtensionsButton label={t("rail.extensions")} onClick={() => openPage("extensions")} />
}

/** How many tasks each project header holds, folded or not. */
export function groupCounts(rows: readonly NavRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  let head = ""
  for (const row of rows) {
    if (row.kind === "project") head = row.id
    else if (row.kind === "task") counts.set(head, (counts.get(head) ?? 0) + 1)
  }
  return counts
}
