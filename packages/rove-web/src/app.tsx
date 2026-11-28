/** Layout: Tasks rail | workspace (tab strip + terminal) | Files, over a one-line status footer, like the TUI. */

import { type CSSProperties, useEffect, useState } from "react"
import { AppearanceErrorBanner, OuterAppearanceBoundary } from "./appearance/boundaries.tsx"
import { AppearanceSlot } from "./appearance/declarative.tsx"
import { useActiveAppearancePack } from "./appearance/runtime.ts"
import { backSwiping } from "./back-swipe.ts"
import { ConnectScreen } from "./connect-view.tsx"
import { useDaemonHealth } from "./daemon-health.tsx"
import { DocumentTitle } from "./document-title.tsx"
import { useEscapeInterrupt } from "./esc-interrupt.ts"
import { t, useLocale } from "./i18n/index.ts"
import { CELL_PX, MIN_WORKSPACE_WIDTH, enterWorkspace, narrowPane, surfaceFor, useNarrow } from "./layout.ts"
import { maybeAskLegacyAdopt } from "./legacy-adopt-prompt.tsx"
import { LoginScreen } from "./login-view.tsx"
import { passwordLoginOn } from "./login.ts"
import { type AppModel, selectedRow } from "./model.ts"
import { Overlays } from "./overlays.tsx"
import { PANEL_MIN_PX, clampPanelWidth, panelExpanded, panelWidth } from "./panel-layout.ts"
import { usePanelShown, useTaskPanel } from "./panel-state.ts"
import { usePluginChords } from "./plugin-keys.ts"
import { PrefixHud } from "./prefix-guide.tsx"
import { usePrefixLayer } from "./prefix.tsx"
import { usePrefsApply } from "./prefs-apply.ts"
import { RailBar } from "./rail-chrome.tsx"
import { RAIL_DEFAULT_PX, clampRailWidth, peekRail, railFolded, railPeek, railWidth } from "./rail-layout.ts"
import { RailView } from "./rail-view.tsx"
import { SettingsDialog } from "./settings-view.tsx"
import { SidePanel } from "./side-panel.tsx"
import { useSkillStatus } from "./skill-status.ts"
import { StatusBar } from "./status-bar.tsx"
import { useStore } from "./store.ts"
import { dialog, layoutMoving, newSession, openNewSessionFromLink, page } from "./ui.ts"
import { apShellClass } from "./ui/appearance.ts"
import { PhoneBarHost } from "./ui/phone.tsx"
import { APP_SHELL, RAIL_PEEK_EDGE, appClass } from "./ui/shell.ts"
import { maybeAskToUpdate } from "./update-prompt.tsx"
import { checkForUpdate, maybeShowWhatsNew } from "./update-view.tsx"
import { useUserKeys } from "./user-keys.ts"
import { followTaskLinks } from "./web-push.ts"
import { useWorkspaceKeys } from "./workspace-keys.tsx"
import { Workspace } from "./workspace-view.tsx"

export function App({ model }: { model: AppModel }) {
  useLocale()
  const conn = useStore(model.client.conn)
  // Never connected and failing: most likely a stale or wrong link, so offer to replace it.
  if (conn.hello === null && conn.failures >= 2) return <RejectedScreen />
  return (
    <OuterAppearanceBoundary>
      <Shell model={model} />
    </OuterAppearanceBoundary>
  )
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
    maybeShowWhatsNew(model.client, hello.roveVersion)
    // A page left open for days still hears about a release: ask the registry again each hour.
    const check = () => void checkForUpdate(model.client).then(maybeAskToUpdate)
    check()
    const hourly = window.setInterval(check, 3_600_000)
    return () => window.clearInterval(hourly)
  }, [hello, model.client])
  // Rows an older Rove added by itself: asked once per page, like the TUI at launch.
  useEffect(() => {
    if (hello) void maybeAskLegacyAdopt(model)
  }, [hello, model])
  usePluginChords(model)
  useWorkspaceKeys(model)
  useEscapeInterrupt()
  useUserKeys(model.client)
  usePrefsApply(model)
  useDaemonHealth(model.client)
  useSkillStatus(model.client)
  // Narrow mode shows one panel: opening the composer or picking a task (rail, Inbox, a page, a menu)
  // brings it up; a page does so through `openPage`.
  useEffect(() => {
    model.onSelect = enterWorkspace
    const off = newSession.subscribe(() => {
      if (newSession.get() !== null) enterWorkspace()
    })
    openNewSessionFromLink()
    return off
  }, [model])
  // A push notification's click: `?task=` on a fresh page, a worker message on an open one.
  useEffect(() => followTaskLinks(model), [model])
  const selection = useStore(model.selection)
  const payload = useStore(model.tasks)
  const remote = useStore(model.remote)
  const narrow = useNarrow()
  const folded = useStore(railFolded)
  const peek = useStore(railPeek)
  const pinned = useStore(railWidth)
  const pane = useStore(narrowPane)
  const backing = useStore(backSwiping) === "app"
  const panelPinned = useStore(panelWidth)
  const panelWide = useStore(panelExpanded)
  const pageOn = useStore(page)
  const dragging = useStore(layoutMoving) === "drag"
  const composing = useStore(newSession) !== null
  // A task on a machine that answers opens like a local one; an unreachable one says where it lives.
  const reachable = remote.find((row) => row.id === selection.taskId && !row.machine?.stale)
  const task = selectedRow(payload, selection.taskId) ?? reachable ?? null
  const remoteTask = reachable ? undefined : remote.find((row) => row.id === selection.taskId)
  // The panel is open while the task has a column; a task whose panel was emptied leaves the column shut.
  const panelShown = usePanelShown(task?.id ?? null)
  const panelColumns = useTaskPanel(task?.id ?? "").columns.length
  const surface = narrow ? surfaceFor(pane, !!task || !!remoteTask, pageOn !== null || composing) : null
  // A phone on its list, a page or the composer shows no task: its waiting engine stays in the Inbox.
  useEffect(
    () => model.setTaskShown(surface === null || (surface === "content" && pageOn === null && !composing)),
    [model, surface, pageOn, composing],
  )
  const pack = useActiveAppearancePack()
  const packFrame = pack?.manifest.layout?.frame
  const packRailWidth = pack?.manifest.layout?.railWidth
  const openPx = clampRailWidth(pinned ?? packRailWidth ?? RAIL_DEFAULT_PX)
  const panelPx = panelPinned === null ? null : clampPanelWidth(panelPinned, folded ? 0 : openPx)
  // Unpinned, the panel is a share of what the rail leaves rather than a size of its own, so opening the rail
  // narrows the browser and the terminal together instead of crushing the terminal. The terminal keeps
  // `MIN_WORKSPACE_WIDTH` of that row.
  const share = Math.max(1, panelColumns)
  const autoW =
    `max(${PANEL_MIN_PX}px, min(calc((100% - var(--rail-w)) * ${share} / ${share + 2}), ` +
    `calc(100% - var(--rail-w) - ${MIN_WORKSPACE_WIDTH * CELL_PX}px)))`
  // The rail's contents keep a width of their own while the column is shut: folded, it floats at the default
  // width, since a width dragged for the docked column (often a narrow one) is not one picked for the overlay.
  const railVars = {
    "--rail-w": `${folded ? 0 : openPx}px`,
    "--rail-open-w": `${folded ? clampRailWidth(RAIL_DEFAULT_PX) : openPx}px`,
    "--panel-w": panelPx !== null ? `${panelPx}px` : autoW,
  } as CSSProperties
  const grid = (
    <div
      className={`${appClass({
        panel: panelShown && (!!task || !!remoteTask) && !narrow,
        expanded: panelWide && panelShown && !narrow,
        surface: surface && backing ? "back" : surface,
        folded: folded && !narrow,
        peek: folded && peek && !narrow,
        dragging,
      })} ${!narrow ? apShellClass(packFrame) : ""}`}
      style={narrow ? undefined : railVars}
    >
      {!narrow && <RailBar model={model} />}
      {/* Folded, the page's left edge brings the rail back as a floating panel, and a click on it unfolds;
          leaving the edge without reaching the rail (out of the window, a quick flick) closes it again. */}
      {folded && !narrow && (
        <div
          className={RAIL_PEEK_EDGE}
          title={t("layout.railUnfold")}
          onMouseEnter={() => peekRail(true)}
          onMouseLeave={() => peekRail(false)}
          // Mouse only: the keyboard reaches the fold through the bar's button.
          onMouseUp={() => railFolded.set(false)}
        />
      )}
      <RailView model={model} narrow={narrow} />
      <Workspace model={model} narrow={narrow} />
      {/* One bar over both panels: the list's, the open page's, or none. A back swipe keeps the page's until it lands. */}
      {surface && <PhoneBarHost show={surface === "sidebar" ? "list" : "page"} />}
      {!narrow && <SidePanel model={model} task={task} remoteHost={remoteTask?.machine?.label} />}
      <StatusBar model={model} narrow={narrow} />
      <Overlays />
      <PrefixHud model={model} />
      <DocumentTitle model={model} />
    </div>
  )
  return (
    <div className={APP_SHELL}>
      <AppearanceErrorBanner
        client={model.client}
        onOpenSettings={() => dialog.set(<SettingsDialog model={model} section="appearance" />)}
      />
      <AppearanceSlot
        slot="shell.frame"
        data={{
          taskCount: (payload?.tasks.length ?? 0) + remote.length,
          selectedTitle: task?.label ?? "",
          panelOpen: panelShown && !narrow,
          railFolded: folded && !narrow,
          narrow,
        }}
        fallback={grid}
      />
    </div>
  )
}
