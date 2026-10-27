import type { CSSProperties } from "react"
import { useEffect } from "react"
import { t } from "./i18n/index.ts"
import { RemoteNotice } from "./machines-view.tsx"
import { type AppModel, selectedRow } from "./model.ts"
import { trackNav } from "./nav-history.ts"
import { NewChatDialog } from "./new-chat-dialog.tsx"
import { NewSessionView } from "./new-session-view.tsx"
import { PagesHost } from "./pages-host.tsx"
import { narrowView } from "./panel-layout.ts"
import { NarrowBackBar } from "./rail-chrome.tsx"
import { SidePanel } from "./side-panel.tsx"
import { SplitPane } from "./split-view.tsx"
import { useStore } from "./store.ts"
import { TabStrip } from "./tab-strip.tsx"
import { useTaskColor } from "./task-colors.ts"
import { newChatHere } from "./task-dialogs.tsx"
import { dialog, newSession, page } from "./ui.ts"
import { UpdateView } from "./update-view.tsx"
import { WelcomePane } from "./welcome-view.tsx"
import { WorktreesView } from "./worktrees-view.tsx"

export function Workspace({ model, narrow }: { model: AppModel; narrow: boolean }) {
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
  const pageOn = useStore(page)
  const taskInk = useTaskColor(task?.id)
  const working = task?.rowStatus?.kind === "running"
  const composing = useStore(newSession)
  const panelOn = useStore(narrowView) !== "terminal" && narrow && !!task
  // Picking a task or tab leaves the composer and the narrow panel view, as it leaves a page; a tab sweep
  // that rewrites the same selection does not.
  useEffect(() => {
    let last = model.selection.get()
    return model.selection.subscribe(() => {
      newSession.set(null)
      const next = model.selection.get()
      if (next.taskId !== last.taskId || next.tabId !== last.tabId) narrowView.set("terminal")
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
          {/* A different project's or machine's + remounts the composer so its chips follow; the prompt draft survives. */}
          <NewSessionView key={`${composing.machine ?? ""}\0${composing.repo ?? ""}`} model={model} seed={composing} />
        </div>
      </main>
    )
  }
  return (
    <main className="workspace">
      {narrow && <NarrowBackBar taskId={task?.id} />}
      {task && <TabStrip model={model} task={task} tabs={tabs} narrow={narrow} />}
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
        {task && tabsKnown && tabs.length === 0 && !panelOn && (
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
        {task && panelOn && <SidePanel model={model} task={task} narrow />}
        {task && selection.tabId && tabs.some((tab) => tab.id === selection.tabId) && (
          <div className={`term-slot ${panelOn ? "is-hidden" : ""}`}>
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
