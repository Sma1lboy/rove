import type { CSSProperties } from "react"
import { useEffect } from "react"
import { AttemptsStrip } from "./attempts-strip.tsx"
import { t } from "./i18n/index.ts"
import { openMachines } from "./machines-dialog.tsx"
import { RemoteNotice } from "./machines-view.tsx"
import { type AppModel, selectedRow } from "./model.ts"
import { trackNav } from "./nav-history.ts"
import { NewChatDialog } from "./new-chat-dialog.tsx"
import { NewSessionView } from "./new-session-view.tsx"
import { PagesHost } from "./pages-host.tsx"
import { narrowView, openNarrowView } from "./panel-layout.ts"
import { NarrowBackBar } from "./rail-chrome.tsx"
import { composerKey } from "./retry-seed.ts"
import { SidePanel } from "./side-panel.tsx"
import { SplitPane } from "./split-view.tsx"
import { StackStrip } from "./stack-strip.tsx"
import { useStore } from "./store.ts"
import { TabStrip } from "./tab-strip.tsx"
import { useTaskColor } from "./task-colors.ts"
import { newChatHere, openTab } from "./task-dialogs.tsx"
import { TermComposer } from "./term-composer.tsx"
import { dialog, newSession, page, toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { PANE, PANE_WORKING, PLACEHOLDER, PLACEHOLDER_BOX, WORKSPACE, WORKSPACE_FRAME } from "./ui/shell.ts"
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
  const view = useStore(narrowView)
  const panelOn = view !== "terminal" && narrow && !!task
  const selectedTab = tabs.find((tab) => tab.id === selection.tabId)
  // Picking a task or tab leaves the composer and the narrow panel view, as it leaves a page; a tab sweep
  // that rewrites the same selection does not.
  useEffect(() => {
    let last = model.selection.get()
    // The phone's opening view waits until the selected tab is known: an engine tab may open on Chat.
    let undecided = true
    const decide = () => {
      const { taskId, tabId } = model.selection.get()
      const tab = taskId ? model.tabs.get()[taskId]?.find((row) => row.id === tabId) : undefined
      if (!undecided || !taskId || !tab) return
      undecided = false
      openNarrowView(taskId, tab.id, tab.kind === "engine")
    }
    const offSelection = model.selection.subscribe(() => {
      page.set(null)
      newSession.set(null)
      const next = model.selection.get()
      if (next.taskId !== last.taskId || next.tabId !== last.tabId) {
        narrowView.set("terminal")
        undecided = true
        decide()
      }
      last = next
    })
    const offTabs = model.tabs.subscribe(decide)
    decide()
    return () => {
      offSelection()
      offTabs()
    }
  }, [model])
  useEffect(() => trackNav(model), [model])
  if (pageOn === "worktrees") {
    return (
      <main className={`${WORKSPACE} ${WORKSPACE_FRAME}`}>
        {narrow && <NarrowBackBar client={model.client} />}
        <WorktreesView model={model} />
      </main>
    )
  }
  if (pageOn) {
    return (
      <main className={`${WORKSPACE} ${WORKSPACE_FRAME}`}>
        {narrow && <NarrowBackBar client={model.client} />}
        <PagesHost model={model} page={pageOn} />
      </main>
    )
  }
  if (composing) {
    return (
      <main className={`${WORKSPACE} ${WORKSPACE_FRAME}`}>
        {narrow && <NarrowBackBar client={model.client} />}
        <div className={PANE}>
          {/* A different seed remounts the composer so its chips follow; the prompt draft survives. */}
          <NewSessionView key={composerKey(composing)} model={model} seed={composing} />
        </div>
      </main>
    )
  }
  return (
    <main className={`${WORKSPACE} ${WORKSPACE_FRAME}`}>
      {narrow && <NarrowBackBar client={model.client} taskId={task?.id} tabId={selection.tabId} title={task?.title} />}
      {task && <TabStrip model={model} task={task} tabs={tabs} narrow={narrow} />}
      {task && !task.groupId && <StackStrip model={model} taskId={task.id} />}
      {task?.groupId && <AttemptsStrip model={model} taskId={task.id} groupId={task.groupId} />}
      <div
        className={`${PANE} ${working ? PANE_WORKING : ""}`}
        style={taskInk ? ({ "--task-ink": taskInk } as CSSProperties) : undefined}
      >
        {!narrow && !task && !remoteTask && payload && payload.tasks.length + remote.length === 0 && (
          <WelcomePane model={model} />
        )}
        {!task && !remoteTask && payload && payload.tasks.length + remote.length > 0 && (
          <p className={PLACEHOLDER}>{t("workspace.pickTask")}</p>
        )}
        {remoteTask?.machine && (
          <div className={PLACEHOLDER_BOX}>
            <RemoteNotice host={remoteTask.machine.label} onMachines={() => openMachines(model)} />
          </div>
        )}
        {task && tabsKnown && tabs.length === 0 && !panelOn && (
          <div className={PLACEHOLDER_BOX}>
            <p>{t("workspace.noTabs")}</p>
            {/* The task's own conversation, relaunched in its tab-1 on its stored command; the others make a different child. */}
            <Button
              variant="filled"
              onClick={() => void openTab(model, task.id, { kind: "engine" }).catch((e) => toast(String(e), "error"))}
            >
              {task.engine ? t("workspace.startEngine", { engine: task.engine.name }) : t("workspace.startSession")}
            </Button>{" "}
            <Button variant="filled" onClick={() => void newChatHere(model, task.id)}>
              {t("menu.newChat")}
            </Button>{" "}
            <Button variant="filled" onClick={() => dialog.set(<NewChatDialog model={model} taskId={task.id} />)}>
              {t("menu.newChatPick")}
            </Button>
          </div>
        )}
        {task && panelOn && (
          <div className="flex min-w-0 flex-1 flex-col">
            <SidePanel model={model} task={task} narrow />
            {/* Chat reads the engine's conversation; the message composer comes along so the phone can still answer it. */}
            {view === "chat" && selectedTab?.kind === "engine" && (
              <TermComposer model={model} taskId={task.id} tabId={selectedTab.id} />
            )}
          </div>
        )}
        {task && selection.tabId && tabs.some((tab) => tab.id === selection.tabId) && (
          <div className={`min-w-0 flex-1 ${panelOn ? "hidden" : "flex"}`}>
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
