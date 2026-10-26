/** Layout: Tasks rail | workspace (tab strip + terminal) | Files, over a one-line status footer, like the TUI. */

import { type CSSProperties, useEffect, useState } from "react"
import { ConnectScreen } from "./connect-view.tsx"
import { DaemonBanner, refreshRove, useDaemonHealth } from "./daemon-health.tsx"
import { DocumentTitle } from "./document-title.tsx"
import { useLocale } from "./i18n/index.ts"
import { enterWorkspace, narrowPane, surfaceFor, useNarrow } from "./layout.ts"
import { LoginScreen } from "./login-view.tsx"
import { passwordLoginOn } from "./login.ts"
import { type AppModel, selectedRow } from "./model.ts"
import { Overlays } from "./overlays.tsx"
import { clampPanelWidth, panelOpen, panelWidth } from "./panel-layout.ts"
import { usePluginChords } from "./plugin-keys.ts"
import { PrefixHud } from "./prefix-guide.tsx"
import { usePrefixLayer } from "./prefix.tsx"
import { usePrefsApply } from "./prefs-apply.ts"
import { RailBar } from "./rail-chrome.tsx"
import { RAIL_DEFAULT_PX, clampRailWidth, peekRail, railFolded, railPeek, railWidth } from "./rail-layout.ts"
import { RailView } from "./rail-view.tsx"
import { SidePanel } from "./side-panel.tsx"
import { StatusBar } from "./status-bar.tsx"
import { useStore } from "./store.ts"
import { newSession, page, zen } from "./ui.ts"
import { checkForUpdate, maybeShowWhatsNew } from "./update-view.tsx"
import { useUserKeys } from "./user-keys.ts"
import { useWorkspaceKeys } from "./workspace-keys.tsx"
import { Workspace } from "./workspace-view.tsx"

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
  const panelPinned = useStore(panelWidth)
  const panelShown = useStore(panelOpen)
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
  const railVars = {
    "--rail-w": `${folded ? 0 : openPx}px`,
    "--rail-open-w": `${openPx}px`,
    "--panel-w": panelPinned === null ? undefined : `${clampPanelWidth(panelPinned, folded ? 0 : openPx)}px`,
  } as CSSProperties
  return (
    <div className="app-shell">
      <DaemonBanner onRefresh={() => refreshRove(model.client)} />
      <div
        className={`app ${zenOn || !panelShown || (!task && !remoteTask) || narrow ? "is-zen" : ""} ${surface ? `is-narrow narrow-${surface}` : ""} ${folded && !narrow ? "is-rail-folded" : ""} ${folded && peek && !narrow ? "is-rail-peek" : ""}`}
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
        {!narrow && <SidePanel model={model} task={task} remoteHost={remoteTask?.machine?.label} />}
        <StatusBar model={model} narrow={narrow} />
        <Overlays />
        <PrefixHud model={model} />
        <DocumentTitle model={model} />
      </div>
    </div>
  )
}
