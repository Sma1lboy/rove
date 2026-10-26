import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { StatusHints } from "./rail-chrome.tsx"
import { useStore } from "./store.ts"
import { UsageChips } from "./usage-view.tsx"

/** TUI order: usage on the left, key hints on the right; the link speaks up only while it is down. */
export function StatusBar({ model, narrow }: { model: AppModel; narrow: boolean }) {
  const client = model.client
  const conn = useStore(client.conn)
  const selection = useStore(model.selection)
  return (
    <footer className="status">
      <UsageChips client={client} taskId={selection.taskId} tabId={selection.tabId} />
      {conn.state !== "open" && (
        <>
          <span className={`dot state-${conn.state}`} />
          <span>
            {conn.state === "retrying" ? t("status.retrying", { count: conn.failures }) : t("status.connecting")}
          </span>
        </>
      )}
      {conn.state === "retrying" && (
        <button type="button" className="link" onClick={() => client.retryNow()}>
          {t("status.retry")}
        </button>
      )}
      <StatusHints model={model} narrow={narrow} />
    </footer>
  )
}
