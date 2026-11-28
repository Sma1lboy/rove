import { useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { useStore } from "./store.ts"
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
  // A first connect waits out a short grace, a drop shows at once; a phone waits out both.
  const ms = narrow ? PHONE_DOWN_GRACE_MS : conn.state === "connecting" ? CONNECTING_GRACE_MS : 0
  const late = useDownFor(client, ms)
  if (!late) return null
  return (
    <footer className={STATUS_BAR}>
      <span className={connDot(conn.state === "retrying")} />
      <span>{conn.state === "retrying" ? t("status.retrying", { count: conn.failures }) : t("status.connecting")}</span>
      {conn.state === "retrying" && (
        <button type="button" className={LINK} onClick={() => client.retryNow()}>
          {t("status.retry")}
        </button>
      )}
    </footer>
  )
}
