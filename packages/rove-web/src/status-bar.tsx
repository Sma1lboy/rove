import { useEffect, useState } from "react"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { useStore } from "./store.ts"
import { STATUS_BAR, connDot } from "./ui/shell.ts"
import { LINK } from "./ui/text.ts"

/** A first connect usually lands well inside this; only a slow one earns the footer. */
const CONNECTING_GRACE_MS = 1500

/** Nothing while the link is up: the footer exists only to say it is down (or coming back), with a way to retry. */
export function StatusBar({ model }: { model: AppModel }) {
  const client = model.client
  const conn = useStore(client.conn)
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (conn.state !== "connecting") return setSlow(false)
    const timer = window.setTimeout(() => setSlow(true), CONNECTING_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [conn.state])
  if (conn.state === "open" || (conn.state === "connecting" && !slow)) return null
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
