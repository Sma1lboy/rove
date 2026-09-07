/** @jsxImportSource @opentui/react */
/**
 * The workspace center column — the terminal-in-the-middle seam:
 * either the empty "select a task" placeholder or the selected worktree's
 * TerminalTabs (keyed per task so tasks sharing a directory never share
 * component state) — the host composes the workspace's regions, and this
 * region owns the empty-versus-loaded decision.
 */

import type { ReactNode } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator.ts"
import { engineLaunchArgv } from "../../engine/engine-presets.ts"
import { remoteKeyForRepo } from "../../exec/resolve.ts"
import { DEFAULT_TASK_VENDOR, type Task, type VendorId } from "../../types/task.ts"
import type { QuickTaskResult } from "../component/quick-task-composer"
import { useOptionalKV } from "../context/kv"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useAccessor } from "../lib/use-accessor"
import { TerminalTabs } from "./TerminalTabs"
import { EmptyWorkspacePane } from "./empty-workspace-pane"
import { knownTaskTabs, tabsRevision } from "./terminal-tabs-shared"
import { WelcomePane } from "./welcome-pane"

export function ShowWorkspace(props: {
  task: Task | undefined
  worktree: string | null
  orchestrator: RemoteOrchestrator
  focused: boolean
  onRequestFocus: () => void
  onEditorTabReady: (open: (command: readonly string[], label: string) => void) => void
  onEngineSendReady: (send: (text: string) => boolean) => void
  /** Paste-only sibling of `onEngineSendReady` (no submit) — the FileTree `a` @path mention.
   *  Required like its sibling: optional here, dropping the host's wire would
   *  silently make the `a` key dead instead of failing the typecheck. */
  onEnginePasteReady: (paste: (text: string) => boolean) => void
  onDiffTabReady: (open: (relPath: string, label: string, base?: string) => void) => void
  onQuickFork: (repo: string, result: QuickTaskResult) => void
  initialPrompt?: string
  /** The user landed on a tab of the selected task — resolve its episodes. */
  onTabVisited?: (taskId: string, tabId: string) => void
  /** A scratch task's last shell exited — the host deletes the row. */
  onScratchExit?: (taskId: string) => void
  /** ctrl+e's trailing "scratch shell" choice — open a Scratch task. */
  onOpenScratch?: () => void
  /** The ctrl+e picker landed on an engine — persist it and toast the result. */
  onEngineChosen?: (taskId: string, vendor: VendorId) => Promise<void>
}): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  // Optional: this component renders in tests and previews with no KV
  // provider mounted, and the empty-tabs lookup below is a refinement, not a
  // requirement — no provider simply means "tabs unknown", which mounts.
  const kv = useOptionalKV()
  // Subscribe to the tab map's revision counter. `knownTaskTabs` reads a
  // module-level Map, which React cannot see on its own: without the
  // subscription, closing a task's last tab changes the answer below with no
  // re-render, leaving TerminalTabs mounted over an empty tab list it is not
  // built to survive.
  useAccessor(tabsRevision)
  const transcriptActivity = useAccessor(props.orchestrator.transcriptActivityStore())
  const engineTabStates = useAccessor(props.orchestrator.engineTabStatesSignal())
  const tasks = useAccessor(props.orchestrator.tasksSignal())
  if (!props.worktree) {
    // Zero tasks = a brand-new home: teach instead of pointing at an empty
    // sidebar. With tasks present, the short "select a task" line stays.
    if (!tasks.some((task) => !task.deletion)) return <WelcomePane />
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg={theme.textMuted}>{t("workspace.empty.selectTask")}</text>
      </box>
    )
  }
  const path = props.worktree
  // An experimental remote (`ssh://`) project: the worktree lives on the other
  // machine and the PTY host only spawns locally, so `buildEngineSessionLaunch`
  // refuses. Say so here instead of mounting TerminalTabs and letting that
  // refusal throw through the render path — a thrown launch reaches the user as
  // "This pane crashed", which tells them nothing about what is unimplemented.
  const remoteKey = remoteKeyForRepo(props.task?.repo) ?? remoteKeyForRepo(path)
  if (remoteKey) {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg={theme.textMuted}>{t("workspace.empty.remoteUnsupported", { host: remoteKey })}</text>
      </box>
    )
  }
  // A task whose last tab you closed has KNOWN, empty tabs. Mounting
  // TerminalTabs over that list would immediately mint a replacement — its
  // `active` tab is non-null by construction and 17 call sites downstream rely
  // on that — so the empty state is handled by not mounting at all.
  // `null` (never mounted since restart) is NOT empty and must still mount.
  //
  // ENTERING the task revives it (`reviveEmptiedTabs`, called from
  // `activateTask`), so the normal path replaces this placeholder within the
  // same gesture. It still renders, because this component is also reached
  // without an activation — a task selected by restart restore, or one emptied
  // while already on screen — and a blank pane would say nothing at all. The
  // keys it advertises are bound by the pane itself: with no TerminalTabs
  // mounted there is nothing else in this subtree to register them.
  const known = props.task ? knownTaskTabs(kv, String(props.task.id)) : null
  if (known && known.tabs.length === 0 && props.task) {
    return <EmptyWorkspacePane taskId={String(props.task.id)} focused={props.focused} />
  }
  return (
    // The terminal-in-the-middle seam: the center column IS
    // the engine — an in-process PTY (Bun.spawn terminal) running the
    // real interactive CLI, so kobe never re-renders the engine's own
    // TUI. Keyed by TASK, not worktree: two tasks can share a directory
    // (a project-main task + a dir task on the same checkout), and a
    // path key would reuse the component across them — the stale task's
    // TabsState then lands under the new task's persistKey, cloning its
    // tabs into the other task. PTY reuse on switch-back is unaffected:
    // the registry keys are `taskId::tabId`, not React keys.
    <TerminalTabs
      key={props.task?.id ?? path}
      taskId={props.task?.id ?? path}
      worktree={path}
      repo={props.task?.repo}
      taskKind={props.task?.kind}
      scratch={props.task?.scratch === true}
      onScratchExit={() => {
        const taskId = props.task?.id
        if (taskId) props.onScratchExit?.(taskId)
      }}
      onOpenScratch={props.onOpenScratch}
      command={engineLaunchArgv({
        command: props.task?.command,
        vendor: props.task?.vendor,
        effort: props.task?.modelEffort,
      })}
      vendor={props.task?.vendor ?? DEFAULT_TASK_VENDOR}
      modelEffort={props.task?.modelEffort}
      onChooseEngine={
        props.task
          ? (vendor) => {
              const taskId = props.task?.id
              if (!taskId) return
              // The tab is added to LOCAL state first and renders under the new
              // engine's label, so a rejected write looks exactly like a
              // success while the task keeps its previous vendor. Same two
              // toasts the `v` row-chord raises — see applyVendorChange.
              void props.onEngineChosen?.(taskId, vendor)
            }
          : undefined
      }
      focused={props.focused}
      onRequestFocus={props.onRequestFocus}
      onEditorTabReady={props.onEditorTabReady}
      onEngineSendReady={props.onEngineSendReady}
      onEnginePasteReady={props.onEnginePasteReady}
      onDiffTabReady={props.onDiffTabReady}
      onQuickFork={props.onQuickFork}
      initialPrompt={props.initialPrompt}
      // This worktree's slice of the daemon transcript.activity push —
      // flips the tab turn-status loops to shared mode.
      sharedActivity={transcriptActivity?.get(path) ?? null}
      // This task's slice of the hook-driven per-tab engine state — the
      // sub-second chip/notification source (poll stays as fallback).
      hookTabStates={props.task ? engineTabStates.get(props.task.id) : undefined}
      taskTitle={props.task?.title}
      onTabVisited={(tabId) => {
        const taskId = props.task?.id
        if (taskId) props.onTabVisited?.(taskId, tabId)
      }}
      // A confirmed ESC interrupt (hook still claims running, live title
      // says the engine rested) is reported as the
      // `turn-interrupted` the engine's abort path never fires itself.
      onEngineInterrupt={(tabId) => {
        const taskId = props.task?.id
        if (taskId) props.orchestrator.reportEngineInterrupt(taskId, tabId)
      }}
    />
  )
}
