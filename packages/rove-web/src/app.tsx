/** Layout: Tasks rail | workspace (tab strip + terminal) | Files, over a one-line status footer, like the TUI. */

import { tabStripVisible } from "@sma1lboy/rove/src/state/tab-strip.ts"
import { type CSSProperties, useEffect, useState } from "react"
import { forgetToken, saveToken } from "./auth.ts"
import { DaemonBanner, refreshRove, useDaemonHealth } from "./daemon-health.tsx"
import { FilesView } from "./files-view.tsx"
import { t, useLocale } from "./i18n/index.ts"
import { clampRailWidth, foldedPx, narrowPane, railFolded, railWidth, surfaceFor, useNarrow } from "./layout.ts"
import { RemoteNotice } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { NewChatDialog } from "./new-chat-dialog.tsx"
import { Overlays } from "./overlays.tsx"
import { PagesHost } from "./pages-host.tsx"
import { usePluginChords } from "./plugin-keys.ts"
import { PrefixHud } from "./prefix-guide.tsx"
import { usePrefixLayer } from "./prefix.tsx"
import { usePrefsApply } from "./prefs-apply.ts"
import { usePrefs } from "./prefs.ts"
import { PreviewView } from "./preview-view.tsx"
import { NarrowBackBar, StatusHints } from "./rail-chrome.tsx"
import { RailView, openMenu, tabLabel } from "./rail-view.tsx"
import { taskMenu } from "./row-actions.tsx"
import { SplitPane } from "./split-view.tsx"
import { useStore } from "./store.ts"
import { useTaskColor } from "./task-colors.ts"
import { newChatHere } from "./task-dialogs.tsx"
import { tokenFromInput } from "./token-input.ts"
import { dialog, page, preview, zen } from "./ui.ts"
import { UpdateView, checkForUpdate, maybeShowWhatsNew } from "./update-view.tsx"
import { UsageChips } from "./usage-view.tsx"
import { useUserKeys } from "./user-keys.ts"
import { WelcomePane } from "./welcome-view.tsx"
import { useWorkspaceKeys } from "./workspace-keys.tsx"
import { WorktreesView } from "./worktrees-view.tsx"

export function App({ model }: { model: AppModel }) {
  useLocale()
  const conn = useStore(model.client.conn)
  // Never connected and failing: most likely a stale or wrong link, so offer to replace it.
  if (conn.hello === null && conn.failures >= 2) return <ConnectScreen failing />
  return <Shell model={model} />
}

function Shell({ model }: { model: AppModel }) {
  usePrefixLayer(model)
  const hello = useStore(model.client.conn).hello
  // Once per connection: the rail's update chip and the once-per-upgrade What's New.
  useEffect(() => {
    if (!hello) return
    void checkForUpdate(model.client)
    maybeShowWhatsNew(model.client, hello.roveVersion)
  }, [hello, model.client])
  usePluginChords(model)
  useWorkspaceKeys(model)
  useUserKeys(model.client)
  usePrefsApply(model)
  useDaemonHealth(model.client)
  const zenOn = useStore(zen)
  const selection = useStore(model.selection)
  const payload = useStore(model.tasks)
  const remote = useStore(model.remote)
  const narrow = useNarrow()
  const folded = useStore(railFolded)
  const pinned = useStore(railWidth)
  const pane = useStore(narrowPane)
  const pageOn = useStore(page)
  const { prefs } = usePrefs()
  // A task on a machine that answers opens like a local one; an unreachable one says where it lives.
  const reachable = remote.find((row) => row.id === selection.taskId && !row.machine?.stale)
  const task = payload?.tasks.find((row) => row.id === selection.taskId) ?? reachable ?? null
  const remoteTask = reachable ? undefined : remote.find((row) => row.id === selection.taskId)
  const surface = narrow ? surfaceFor(pane, !!task || !!remoteTask, pageOn !== null) : null
  const railPx = folded ? foldedPx(prefs.railFold) : pinned === null ? null : clampRailWidth(pinned)
  return (
    <div className="app-shell">
      <DaemonBanner onRefresh={() => refreshRove(model.client)} />
      <div
        className={`app ${zenOn || (!task && !remoteTask) || narrow ? "is-zen" : ""} ${surface ? `is-narrow narrow-${surface}` : ""}`}
        style={railPx !== null && !narrow ? ({ "--rail-w": `${railPx}px` } as CSSProperties) : undefined}
      >
        <RailView model={model} narrow={narrow} />
        <Workspace model={model} narrow={narrow} />
        {task && !zenOn && !narrow && <FilesView key={task.id} model={model} task={task} />}
        {remoteTask?.machine && !zenOn && !narrow && (
          <aside className="files">
            <RemoteNotice host={remoteTask.machine.label} />
          </aside>
        )}
        <StatusBar model={model} narrow={narrow} />
        <Overlays />
        <PrefixHud model={model} />
      </div>
    </div>
  )
}

function Workspace({ model, narrow }: { model: AppModel; narrow: boolean }) {
  const selection = useStore(model.selection)
  const allTabs = useStore(model.tabs)
  const payload = useStore(model.tasks)
  const remote = useStore(model.remote)
  const reachable = remote.find((row) => row.id === selection.taskId && !row.machine?.stale)
  const task = payload?.tasks.find((row) => row.id === selection.taskId) ?? reachable ?? null
  const remoteTask = reachable ? undefined : remote.find((row) => row.id === selection.taskId)
  const tabs = task ? (allTabs[task.id] ?? []) : []
  const view = useStore(preview)
  const shown = view && task && view.taskId === task.id ? view : null
  const zenOn = useStore(zen)
  const pageOn = useStore(page)
  const { prefs } = usePrefs()
  const taskInk = useTaskColor(task?.id)
  const working = task?.rowStatus?.kind === "running"
  if (pageOn === "update") {
    return (
      <main className="workspace">
        {narrow && <NarrowBackBar />}
        <UpdateView client={model.client} />
      </main>
    )
  }
  if (pageOn === "worktrees") {
    return (
      <main className="workspace">
        {narrow && <NarrowBackBar />}
        <WorktreesView model={model} />
      </main>
    )
  }
  if (pageOn) {
    return (
      <main className="workspace">
        {narrow && <NarrowBackBar />}
        <PagesHost model={model} page={pageOn} />
      </main>
    )
  }
  return (
    <main className="workspace">
      {narrow && <NarrowBackBar />}
      {task && (
        <div
          className={`tab-strip ${tabStripVisible(prefs.tabStrip, tabs.length) ? "" : "is-tabs-hidden"}`}
          role="tablist"
        >
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
            title={t("menu.newChatHint")}
            onClick={() => void newChatHere(model, task.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              dialog.set(<NewChatDialog model={model} taskId={task.id} />)
            }}
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
      <div
        className={`pane ${working ? "is-working" : ""}`}
        style={taskInk ? ({ "--task-ink": taskInk } as CSSProperties) : undefined}
      >
        {!task && !remoteTask && payload && payload.tasks.length + remote.length === 0 && <WelcomePane model={model} />}
        {!task && !remoteTask && payload && payload.tasks.length + remote.length > 0 && (
          <p className="placeholder">{t("workspace.pickTask")}</p>
        )}
        {remoteTask?.machine && (
          <div className="placeholder">
            <RemoteNotice host={remoteTask.machine.label} />
          </div>
        )}
        {task && tabs.length === 0 && !shown && (
          <div className="placeholder">
            <p>{t("workspace.noTabs")}</p>
            <button type="button" className="button" onClick={() => void newChatHere(model, task.id)}>
              {t("menu.newChat")}
            </button>{" "}
            <button
              type="button"
              className="button"
              onClick={() => dialog.set(<NewChatDialog model={model} taskId={task.id} />)}
            >
              {t("menu.newChatPick")}
            </button>
          </div>
        )}
        {shown && <PreviewView key={`${shown.taskId}:${shown.path}:${shown.scope}`} model={model} view={shown} />}
        {task && selection.tabId && tabs.some((tab) => tab.id === selection.tabId) && (
          <div className={`term-slot ${shown ? "is-hidden" : ""}`}>
            <SplitPane
              key={`${task.id}::${selection.tabId}`}
              model={model}
              taskId={task.id}
              tab={tabs.find((tab) => tab.id === selection.tabId) ?? tabs[0]}
            />
          </div>
        )}
      </div>
    </main>
  )
}

/** TUI order: usage on the left; the right holds what the TUI has no need for (link state, host). */
function StatusBar({ model, narrow }: { model: AppModel; narrow: boolean }) {
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
      <StatusHints model={model} narrow={narrow} />
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
