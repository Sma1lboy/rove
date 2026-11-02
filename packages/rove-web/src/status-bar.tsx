import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { useStore } from "./store.ts"
import { STATUS_BAR, connDot } from "./ui/shell.ts"
import { LINK } from "./ui/text.ts"

/** Nothing while the link is up: the footer exists only to say it is down (or coming back), with a way to retry. */
export function StatusBar({ model }: { model: AppModel }) {
  const client = model.client
  const conn = useStore(client.conn)
  if (conn.state === "open") return null
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
