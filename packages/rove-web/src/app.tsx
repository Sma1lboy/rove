/** Layout: Tasks rail | workspace (tab strip + terminal) | Files, over a one-line status footer, like the TUI. */

import { useState } from "react"
import { forgetToken, saveToken } from "./auth.ts"
import { FilesView } from "./files-view.tsx"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { Overlays } from "./overlays.tsx"
import { PrefixHud, usePrefixLayer } from "./prefix.tsx"
import { PreviewView } from "./preview-view.tsx"
import { RailView, openMenu, tabLabel } from "./rail-view.tsx"
import { taskMenu } from "./row-actions.tsx"
import { SettingsDialog } from "./settings-view.tsx"
import { useStore } from "./store.ts"
import { NewChatDialog } from "./task-dialogs.tsx"
import { TerminalView } from "./terminal-view.tsx"
import { tokenFromInput } from "./token-input.ts"
import { dialog, preview, zen } from "./ui.ts"
import { UsageChips } from "./usage-view.tsx"

export function App({ model }: { model: AppModel }) {
  useLocale()
  const conn = useStore(model.client.conn)
  // Never connected and failing: most likely a stale or wrong link, so offer to replace it.
  if (conn.hello === null && conn.failures >= 2) return <ConnectScreen failing />
  return <Shell model={model} />
}

function Shell({ model }: { model: AppModel }) {
  usePrefixLayer(model)
  const zenOn = useStore(zen)
  const selection = useStore(model.selection)
  const payload = useStore(model.tasks)
  const task = payload?.tasks.find((row) => row.id === selection.taskId) ?? null
  return (
    <div className={`app ${zenOn || !task ? "is-zen" : ""}`}>
      <RailView model={model} />
      <Workspace model={model} />
      {task && !zenOn && <FilesView key={task.id} model={model} task={task} />}
      <StatusBar model={model} />
      <Overlays />
      <PrefixHud model={model} />
    </div>
  )
}

function Workspace({ model }: { model: AppModel }) {
  const selection = useStore(model.selection)
  const allTabs = useStore(model.tabs)
  const payload = useStore(model.tasks)
  const task = payload?.tasks.find((row) => row.id === selection.taskId) ?? null
  const tabs = task ? (allTabs[task.id] ?? []) : []
  const view = useStore(preview)
  const shown = view && task && view.taskId === task.id ? view : null
  const zenOn = useStore(zen)
  return (
    <main className="workspace">
      {task && (
        <div className="tab-strip" role="tablist">
          {tabs.map((tab, i) => (
            <button
              type="button"
              role="tab"
              key={tab.id}
              aria-selected={tab.id === selection.tabId}
              className={`tab ${tab.id === selection.tabId && !shown ? "is-active" : ""}`}
              onClick={() => {
                preview.set(null)
                model.select(task.id, tab.id)
              }}
              onContextMenu={(e) => openMenu(e, taskMenu(model, task, tab))}
            >
              <span className="tab-index">{i + 1}</span>
              {tabLabel(tab)}
            </button>
          ))}
          {shown && (
            <span className="tab is-active tab-preview" title={shown.path}>
              <span className="tab-index">{shown.path === "." ? "D" : "d"}</span>
              {shown.path === "." ? t("preview.whole") : shown.path}
              <button
                type="button"
                className="tab-close"
                aria-label={t("preview.close")}
                onClick={() => preview.set(null)}
              >
                ×
              </button>
            </span>
          )}
          <button
            type="button"
            className="tab tab-new"
            title={t("menu.newChat")}
            onClick={() => dialog.set(<NewChatDialog model={model} taskId={task.id} />)}
          >
            +
          </button>
          {zenOn && (
            <button type="button" className="tab tab-new" onClick={() => zen.set(false)}>
              {t("files.show")}
            </button>
          )}
          <span className="tab-strip-title" title={task.branch}>
            {task.title}
          </span>
        </div>
      )}
      <div className="pane">
        {!task && <p className="placeholder">{t("workspace.pickTask")}</p>}
        {task && tabs.length === 0 && !shown && (
          <div className="placeholder">
            <p>{t("workspace.noTabs")}</p>
            <button
              type="button"
              className="button"
              onClick={() => dialog.set(<NewChatDialog model={model} taskId={task.id} />)}
            >
              {t("menu.newChat")}
            </button>
          </div>
        )}
        {shown && <PreviewView key={`${shown.taskId}:${shown.path}:${shown.scope}`} model={model} view={shown} />}
        {task && selection.tabId && tabs.some((tab) => tab.id === selection.tabId) && (
          <div className={`term-slot ${shown ? "is-hidden" : ""}`}>
            <TerminalView
              key={`${task.id}::${selection.tabId}`}
              client={model.client}
              taskId={task.id}
              tabId={selection.tabId}
            />
          </div>
        )}
      </div>
    </main>
  )
}

/** TUI order: usage on the left; the right holds what the TUI has no need for (link state, host). */
function StatusBar({ model }: { model: AppModel }) {
  const client = model.client
  const conn = useStore(client.conn)
  const selection = useStore(model.selection)
  return (
    <footer className="status">
      <UsageChips client={client} taskId={selection.taskId} tabId={selection.tabId} />
      <span className="spacer" />
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
      {conn.hello && (
        <span className="muted">{t("status.host", { host: conn.hello.host, version: conn.hello.roveVersion })}</span>
      )}
      <button type="button" className="link" onClick={() => dialog.set(<SettingsDialog client={client} />)}>
        [{t("settings.open")}]
      </button>
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
