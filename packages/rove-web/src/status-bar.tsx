import { useEffect, useState } from "react"
import { AppearanceSlot } from "./appearance/declarative.tsx"
import { useActiveAppearancePack } from "./appearance/runtime.ts"
import type { BridgeClient } from "./bridge.ts"
import { t } from "./i18n/index.ts"
import { type AppModel, selectedRow } from "./model.ts"
import { useStore } from "./store.ts"
import { AP_STATUS_BAR } from "./ui/appearance.ts"
import { STATUS_BAR, connDot } from "./ui/shell.ts"
import { LINK } from "./ui/text.ts"

/** A first connect usually lands well inside this; only a slow one earns the footer. */
const CONNECTING_GRACE_MS = 1500
/** A phone back from the background reconnects within a second or two; only a link down this long is news there. */
export const PHONE_DOWN_GRACE_MS = 8000

/** True once the link has been down for `ms` without a break: connecting ↔ retrying is one outage, so its clock runs on. */
export function useDownFor(client: BridgeClient, ms: number): boolean {
  const down = useStore(client.conn).state !== "open"
  const [late, setLate] = useState(false)
  useEffect(() => {
    setLate(false)
    if (!down) return
    const timer = window.setTimeout(() => setLate(true), ms)
    return () => window.clearTimeout(timer)
  }, [down, ms])
  return down && late
}

/** Nothing while the link is up: the footer exists only to say it is down (or coming back), with a way to retry. */
export function StatusBar({ model, narrow }: { model: AppModel; narrow: boolean }) {
  const client = model.client
  const conn = useStore(client.conn)
  const payload = useStore(model.tasks)
  const selection = useStore(model.selection)
  const pack = useActiveAppearancePack()
  const task = selectedRow(payload, selection.taskId)
  // A first connect waits out a short grace, a drop shows at once; a phone waits out both.
  const ms = narrow ? PHONE_DOWN_GRACE_MS : conn.state === "connecting" ? CONNECTING_GRACE_MS : 0
  const late = useDownFor(client, ms)
  const mode = pack?.manifest.layout?.statusBar ?? "auto"
  const customStatusSlot = Boolean(pack?.manifest.slots?.["status.bar"])
  if (mode === "hidden" && !late) return null
  if (!late && mode !== "always" && !customStatusSlot) return null

  const diffStats =
    task?.changes && !("unreadable" in task.changes)
      ? { files: 0, added: task.changes.added, removed: task.changes.deleted }
      : undefined
  const defaultBar = late ? (
    <footer className={STATUS_BAR}>
      <span className={connDot(conn.state === "retrying")} />
      <span>{conn.state === "retrying" ? t("status.retrying", { count: conn.failures }) : t("status.connecting")}</span>
      {conn.state === "retrying" && (
        <button type="button" className={LINK} onClick={() => client.retryNow()}>
          {t("status.retry")}
        </button>
      )}
    </footer>
  ) : (
    <footer className={AP_STATUS_BAR}>
      <span>{conn.state}</span>
      {task?.label && <span className="truncate text-ink">{task.label}</span>}
      {task?.branch && <span className="truncate">{task.branch}</span>}
      {task?.engine?.name && <span>{task.engine.name}</span>}
    </footer>
  )

  return (
    <AppearanceSlot
      slot="status.bar"
      data={{
        connection: conn.state === "open" ? "open" : conn.state === "retrying" ? "retrying" : "connecting",
        failures: conn.failures,
        taskTitle: task?.label,
        branch: task?.branch,
        engineName: task?.engine?.name,
        statusKind: task?.rowStatus?.kind,
        diffStats,
        usageSummary: "",
        onRetry: () => client.retryNow(),
      }}
      fallback={defaultBar}
    />
  )
}
