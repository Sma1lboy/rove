/** The session list as a phone draws it: two-line rows with a status mark, group headers with a ⋯, and the line under the wordmark. */

import { useEffect, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { openPage } from "./layout.ts"
import { CloudMark } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { useCopy, useReload } from "./pages-kit.ts"
import { extPages, lastExtPage, rememberExtPage, sessionLine2 } from "./phone-rows.ts"
import { PrChip } from "./pr-chip.tsx"
import type { RailRowProps } from "./rail-view.tsx"
import { lastReply, requestRemembered } from "./remembered.ts"
import { type RoutinesReply, routineNeedsYou } from "./routines-data.ts"
import { SettingsDialog } from "./settings-view.tsx"
import { useStore } from "./store.ts"
import { dialog } from "./ui.ts"
import { EngineIcon } from "./ui/engine-icon.tsx"
import { ExtensionsButton, PhoneGroupHead, PhoneStatusRow, RoutinesButton } from "./ui/phone-rows.tsx"
import { CHILD_INDENT, guideClass, projectHead } from "./ui/rail.ts"
import { SHEET_LIST, SHEET_SEP, Sheet, SheetRow } from "./ui/sheet.tsx"
import { StatusDots } from "./ui/status-dots.tsx"
import { SwipeRow } from "./ui/swipe-row.tsx"

export function PhoneRailRow(props: RailRowProps) {
  const { row } = props
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
  const status = row.fold?.collapsed ? props.rollup : task.rowStatus
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
      mark={<EngineIcon icon={props.engineIcon} name={task.engine?.name} />}
      title={row.attempt ?? task.label}
      dim={props.stale}
      selected={props.selected}
      line2={
        <>
          {props.repo && <span className="max-w-24 flex-none truncate text-subtle">{props.repo}</span>}
          {line.branch && <span className="min-w-0 truncate">{line.branch}</span>}
          {line.behind && <span className="flex-none tabular-nums">{line.behind}</span>}
          {row.fold?.collapsed && <span className="flex-none text-subtle">+{row.fold.count}</span>}
          {task.pinned && <span className="flex-none text-subtle">▴</span>}
          <PrChip tasks={props.prTasks ?? [task]} />
          {props.cloud && <CloudMark label={props.cloud} />}
        </>
      }
      status={<StatusDots status={status} />}
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

/** Under the wordmark only while the page can't reach the computer; the computer's name is in Settings → About. */
export function PhoneRailNote({ model }: { model: AppModel }) {
  useLocale()
  const conn = useStore(model.client.conn)
  if (conn.state === "open") return null
  return (
    <p className="m-0 truncate px-4 pb-2 font-sans text-meta text-muted" data-rail-note>
      {t(conn.state === "retrying" ? "rail.reconnecting" : "status.connecting")}
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

/**
 * Top right of the list: a sheet of the pages extensions add, the one opened last first, then the way to add one.
 * Shown with none installed too: the sheet is then that one row.
 */
export function PhoneExtensions({ model }: { model: AppModel }) {
  const { nav } = useCopy()
  const [open, setOpen] = useState(false)
  const last = useStore(lastExtPage)
  const pages = extPages(useStore(model.installedMods), useStore(model.mods), nav)
  const ordered = [...pages].sort((a, b) => Number(b.id === last) - Number(a.id === last))
  const title = t("rail.extensions")
  return (
    <>
      <ExtensionsButton label={title} onClick={() => setOpen(true)} />
      {open && (
        <Sheet label={title} title={title} onClose={() => setOpen(false)}>
          {(close) => (
            <div className={SHEET_LIST}>
              {ordered.map((entry) => (
                <SheetRow
                  key={entry.id}
                  data-ext-row={entry.id}
                  onClick={() => {
                    close()
                    rememberExtPage(entry)
                    openPage(entry.page)
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  <span className="flex-none font-mono text-meta text-subtle">
                    {entry.id === last ? t("rail.lastOpened") : entry.note}
                  </span>
                </SheetRow>
              ))}
              {ordered.length > 0 && <hr className={SHEET_SEP} />}
              <SheetRow
                data-ext-row="add"
                onClick={() => {
                  close()
                  dialog.set(<SettingsDialog model={model} section="plugins" />)
                }}
              >
                <span className="w-4 flex-none text-center text-accent">+</span>
                <span className="min-w-0 flex-1 truncate">{t("rail.addExtension")}</span>
              </SheetRow>
            </div>
          )}
        </Sheet>
      )}
    </>
  )
}
