/** Layout: Tasks rail | workspace (tab strip + terminal) | Files, over a one-line status footer, like the TUI. */

import { tabStripVisible } from "@sma1lboy/rove/src/state/tab-strip.ts"
import { type CSSProperties, useEffect, useState } from "react"
import { forgetToken, saveToken } from "./auth.ts"
import { DaemonBanner, refreshRove, useDaemonHealth } from "./daemon-health.tsx"
import { FilesView } from "./files-view.tsx"
import { t, useLocale } from "./i18n/index.ts"
import {
  RAIL_DEFAULT_PX,
  clampRailWidth,
  enterWorkspace,
  narrowFiles,
  narrowPane,
  peekRail,
  railFolded,
  railPeek,
  railWidth,
  surfaceFor,
  useNarrow,
} from "./layout.ts"
import { LoginScreen } from "./login-view.tsx"
import { passwordLoginOn } from "./login.ts"
import { RemoteNotice } from "./machines-view.tsx"
import { type AppModel, selectedRow } from "./model.ts"
import { trackNav } from "./nav-history.ts"
import { NewChatDialog } from "./new-chat-dialog.tsx"
import { NewSessionView } from "./new-session-view.tsx"
import { Overlays } from "./overlays.tsx"
import { PagesHost } from "./pages-host.tsx"
import { usePluginChords } from "./plugin-keys.ts"
import { PrefixHud } from "./prefix-guide.tsx"
import { usePrefixLayer } from "./prefix.tsx"
import { usePrefsApply } from "./prefs-apply.ts"
import { usePrefs } from "./prefs.ts"
import { PreviewView } from "./preview-view.tsx"
import { NarrowBackBar, RailBar, StatusHints } from "./rail-chrome.tsx"
import { RailView, openMenu, tabLabel } from "./rail-view.tsx"
import { taskMenu } from "./row-actions.tsx"
import { SplitPane } from "./split-view.tsx"
import { useStore } from "./store.ts"
import { useTaskColor } from "./task-colors.ts"
import { newChatHere } from "./task-dialogs.tsx"
import { tokenFromInput } from "./token-input.ts"
import { dialog, newSession, page, preview, zen } from "./ui.ts"
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
  if (conn.hello === null && conn.failures >= 2) return <RejectedScreen />
  return <Shell model={model} />
}

/** A stored token the bridge refuses: sign in again where the host has a password, else ask for the link. */
function RejectedScreen() {
  const [password, setPassword] = useState<boolean | null>(null)
  useEffect(() => {
    void passwordLoginOn().then(setPassword)
  }, [])
  if (password === null) return null
  return password ? <LoginScreen /> : <ConnectScreen failing />
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
  // Narrow mode shows one panel: opening the composer or picking a task (rail, Inbox, a page, a menu)
  // brings it up; a page does so through `openPage`.
  useEffect(() => {
    model.onSelect = enterWorkspace
    return newSession.subscribe(() => {
      if (newSession.get() !== null) enterWorkspace()
    })
  }, [model])
  const zenOn = useStore(zen)
  const selection = useStore(model.selection)
  const payload = useStore(model.tasks)
  const remote = useStore(model.remote)
  const narrow = useNarrow()
  const folded = useStore(railFolded)
  const peek = useStore(railPeek)
  const pinned = useStore(railWidth)
  const pane = useStore(narrowPane)
  const pageOn = useStore(page)
  const composing = useStore(newSession) !== null
  // A task on a machine that answers opens like a local one; an unreachable one says where it lives.
  const reachable = remote.find((row) => row.id === selection.taskId && !row.machine?.stale)
  const task = selectedRow(payload, selection.taskId) ?? reachable ?? null
  const remoteTask = reachable ? undefined : remote.find((row) => row.id === selection.taskId)
  const surface = narrow ? surfaceFor(pane, !!task || !!remoteTask, pageOn !== null || composing) : null
  // A phone on its list, a page or the composer shows no task: its waiting engine stays in the Inbox.
  useEffect(
    () => model.setTaskShown(surface === null || (surface === "content" && pageOn === null && !composing)),
    [model, surface, pageOn, composing],
  )
  const openPx = clampRailWidth(pinned ?? RAIL_DEFAULT_PX)
  // The open width rides along while folded, so the rail's contents keep it as the column slides shut.
  const railVars = { "--rail-w": `${folded ? 0 : openPx}px`, "--rail-open-w": `${openPx}px` } as CSSProperties
  return (
    <div className="app-shell">
      <DaemonBanner onRefresh={() => refreshRove(model.client)} />
      <div
        className={`app ${zenOn || (!task && !remoteTask) || narrow ? "is-zen" : ""} ${surface ? `is-narrow narrow-${surface}` : ""} ${folded && !narrow ? "is-rail-folded" : ""} ${folded && peek && !narrow ? "is-rail-peek" : ""}`}
        style={narrow ? undefined : railVars}
      >
        {!narrow && <RailBar model={model} />}
        {/* Folded, the page's left edge brings the rail back as a floating panel; leaving the edge without
            reaching the rail (out of the window, a quick flick) closes it again. */}
        {folded && !narrow && (
          <div className="rail-peek-edge" onMouseEnter={() => peekRail(true)} onMouseLeave={() => peekRail(false)} />
        )}
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
  const task = selectedRow(payload, selection.taskId) ?? reachable ?? null
  const remoteTask = reachable ? undefined : remote.find((row) => row.id === selection.taskId)
  const tabs = task ? (allTabs[task.id] ?? []) : []
  // Before the first `task.tabs` reply the task's tabs are unknown, not empty: no "no sessions" flash.
  const tabsKnown = task ? task.id in allTabs : false
  const view = useStore(preview)
  const shown = view && task && view.taskId === task.id ? view : null
  const pageOn = useStore(page)
  const { prefs } = usePrefs()
  const taskInk = useTaskColor(task?.id)
  const working = task?.rowStatus?.kind === "running"
  const composing = useStore(newSession)
  const filesOn = useStore(narrowFiles) && narrow && !!task
  // Picking a task or tab leaves the composer and the narrow file list, as it leaves a page; a tab sweep
  // that rewrites the same selection does not.
  useEffect(() => {
    let last = model.selection.get()
    return model.selection.subscribe(() => {
      newSession.set(null)
      const next = model.selection.get()
      if (next.taskId !== last.taskId || next.tabId !== last.tabId) narrowFiles.set(false)
      last = next
    })
  }, [model])
  useEffect(() => trackNav(model), [model])
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
  if (composing) {
    return (
      <main className="workspace">
        {narrow && <NarrowBackBar />}
        <div className="pane">
          <NewSessionView model={model} seed={composing} />
        </div>
      </main>
    )
  }
  return (
    <main className="workspace">
      {narrow && <NarrowBackBar taskId={task?.id} />}
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
        </div>
      )}
      <div
        className={`pane ${working ? "is-working" : ""}`}
        style={taskInk ? ({ "--task-ink": taskInk } as CSSProperties) : undefined}
      >
        {!narrow && !task && !remoteTask && payload && payload.tasks.length + remote.length === 0 && (
          <WelcomePane model={model} />
        )}
        {!task && !remoteTask && payload && payload.tasks.length + remote.length > 0 && (
          <p className="placeholder">{t("workspace.pickTask")}</p>
        )}
        {remoteTask?.machine && (
          <div className="placeholder">
            <RemoteNotice host={remoteTask.machine.label} />
          </div>
        )}
        {task && tabsKnown && tabs.length === 0 && !shown && !filesOn && (
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
        {task && filesOn && !shown && <FilesView key={task.id} model={model} task={task} narrow />}
        {task && selection.tabId && tabs.some((tab) => tab.id === selection.tabId) && (
          <div className={`term-slot ${shown || filesOn ? "is-hidden" : ""}`}>
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
      {conn.hello && !narrow && (
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
