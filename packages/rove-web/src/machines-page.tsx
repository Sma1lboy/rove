/**
 * The Machines page: every machine `rove machine add` registered, with its state, its Rove version
 * and how many of its tasks are here. One that is not connected says why (the hub's classified
 * `reason`, never ssh's own text: this page can be open from anywhere) and the command that fixes it,
 * since adding and repairing a machine asks questions only a terminal on this computer can answer.
 */

import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { en, t, useLocale } from "./i18n/index.ts"
import { type MachineRow, machineLabel, useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { usePageFocus, usePageKeys } from "./pages-kit.ts"
import { useStore } from "./store.ts"
import { page } from "./ui.ts"
import * as m from "./ui/machines.ts"
import { PAGE_SCROLL, PAGE_TITLE, PG_LIST, PG_NOTICE } from "./ui/page.ts"

/** Not connected and not on its way: what the rail entry counts. */
export const troubled = (row: MachineRow): boolean => row.state !== "online" && row.state !== "connecting"

/** The reason's sentence; one this build has no words for reads as plain unreachable. */
function reasonText(row: MachineRow): string {
  const key = row.reason && row.reason in en.machines.reason ? row.reason : "unknown"
  return t(`machines.reason.${key}`)
}

function MachineBlock({ row, tasks, locale }: { row: MachineRow; tasks: number; locale: string }) {
  const words = (locale === "zh" ? tasksZh : tasksEn).machine
  const bad = troubled(row)
  return (
    <div className={m.MACHINE_ROW}>
      <div className={m.MACHINE_HEAD}>
        <span className={`${m.MACHINE_NAME} ${bad ? "text-warning" : ""}`}>{machineLabel(row, words)}</span>
        {tasks > 0 && <span className={m.MACHINE_META}>{t("machines.tasks", { count: tasks })}</span>}
      </div>
      {bad && (
        <>
          <p className={m.MACHINE_REASON}>{reasonText(row)}</p>
          <p className={m.MACHINE_FIX}>
            <span>{t("machines.fix")}</span>
            <code className={m.MACHINE_CMD}>{`rove machine doctor ${row.alias}`}</code>
          </p>
        </>
      )}
    </div>
  )
}

export function MachinesPage({ model }: { model: AppModel }) {
  const locale = useLocale()
  const ref = usePageFocus()
  const machines = useMachines(model)
  const remote = useStore(model.remote)
  usePageKeys((e) => {
    if (e.key !== "Escape" && e.key !== "q") return false
    page.set(null)
    return true
  })
  return (
    <section ref={ref} tabIndex={-1} className={PAGE_SCROLL}>
      <h2 className={PAGE_TITLE}>{t("machines.title")}</h2>
      <p className={`${PG_NOTICE} text-muted`}>{t("machines.hint")}</p>
      <div className={PG_LIST}>
        {machines.map((row) => (
          <MachineBlock
            key={row.alias}
            row={row}
            locale={locale}
            tasks={remote.filter((task) => task.machine?.id === row.alias).length}
          />
        ))}
      </div>
    </section>
  )
}
