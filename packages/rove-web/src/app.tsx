/** Layout: Tasks rail | workspace (tab strip + terminal) over a one-line status footer, like the TUI. */

import { useState } from "react"
import { forgetToken, saveToken } from "./auth.ts"
import type { BridgeClient } from "./bridge.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { RailView, tabLabel } from "./rail-view.tsx"
import { useStore } from "./store.ts"
import { TerminalView } from "./terminal-view.tsx"
import { tokenFromInput } from "./token-input.ts"

export function App({ model }: { model: AppModel }) {
  useLocale()
  const conn = useStore(model.client.conn)
  // Never connected and failing: most likely a stale or wrong link, so offer to replace it.
  if (conn.hello === null && conn.failures >= 2) return <ConnectScreen failing />
  return (
    <div className="app">
      <RailView model={model} />
      <Workspace model={model} />
      <StatusBar client={model.client} />
    </div>
  )
}

function Workspace({ model }: { model: AppModel }) {
  const selection = useStore(model.selection)
  const allTabs = useStore(model.tabs)
  const payload = useStore(model.tasks)
  const task = payload?.tasks.find((row) => row.id === selection.taskId) ?? null
  const tabs = task ? (allTabs[task.id] ?? []) : []
  return (
    <main className="workspace">
      {task && tabs.length > 0 && (
        <div className="tab-strip" role="tablist">
          {tabs.map((tab, i) => (
            <button
              type="button"
              role="tab"
              key={tab.id}
              aria-selected={tab.id === selection.tabId}
              className={`tab ${tab.id === selection.tabId ? "is-active" : ""}`}
              onClick={() => model.select(task.id, tab.id)}
            >
              <span className="tab-index">{i + 1}</span>
              {tabLabel(tab)}
            </button>
          ))}
          <span className="tab-strip-title" title={task.branch}>
            {task.title}
          </span>
        </div>
      )}
      <div className="pane">
        {!task && <p className="placeholder">{t("workspace.pickTask")}</p>}
        {task && tabs.length === 0 && <p className="placeholder">{t("workspace.noTabs")}</p>}
        {task && selection.tabId && tabs.some((tab) => tab.id === selection.tabId) && (
          <TerminalView
            key={`${task.id}::${selection.tabId}`}
            client={model.client}
            taskId={task.id}
            tabId={selection.tabId}
          />
        )}
      </div>
    </main>
  )
}

function StatusBar({ client }: { client: BridgeClient }) {
  const conn = useStore(client.conn)
  return (
    <footer className="status">
      <span className={`dot state-${conn.state}`} />
      <span>
        {conn.state === "open"
          ? t("status.open")
          : conn.state === "retrying"
            ? t("status.retrying", { count: conn.failures })
            : t("status.connecting")}
      </span>
      {conn.state === "retrying" && (
        <button type="button" className="link" onClick={() => client.retryNow()}>
          {t("status.retry")}
        </button>
      )}
      <span className="spacer" />
      {conn.hello && (
        <span className="muted">{t("status.host", { host: conn.hello.host, version: conn.hello.roveVersion })}</span>
      )}
    </footer>
  )
}

export function ConnectScreen({ failing = false }: { failing?: boolean }) {
  useLocale()
  const [value, setValue] = useState("")
  const [invalid, setInvalid] = useState(false)
  return (
    <div className="connect">
      <form
        className="connect-card"
        onSubmit={(e) => {
          e.preventDefault()
          const token = tokenFromInput(value)
          if (!token) {
            setInvalid(true)
            return
          }
          saveToken(token)
          window.location.reload()
        }}
      >
        <span className="wordmark">
          <span className="bracket">[</span> rove <span className="bracket">]</span>
        </span>
        <h1 className="kicker">{t("connect.title")}</h1>
        <p className={failing ? "error" : "muted"}>{failing ? t("connect.failing") : t("connect.body")}</p>
        <input
          className="input"
          // biome-ignore lint/a11y/noAutofocus: the only control on the page
          autoFocus
          spellCheck={false}
          placeholder={t("connect.placeholder")}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setInvalid(false)
          }}
        />
        {invalid && <p className="error">{t("connect.invalid")}</p>}
        <div className="actions">
          {failing && (
            <button
              type="button"
              className="link"
              onClick={() => {
                forgetToken()
                window.location.reload()
              }}
            >
              {t("connect.forget")}
            </button>
          )}
          <button type="submit" className="button">
            {t("connect.submit")}
          </button>
        </div>
      </form>
    </div>
  )
}
