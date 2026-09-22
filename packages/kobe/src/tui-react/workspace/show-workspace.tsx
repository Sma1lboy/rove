/** @jsxImportSource @opentui/react */
/**
 * Workspace center column: the "select a task" placeholder or the selected
 * task's TerminalTabs. Owns the empty-versus-loaded decision.
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
  /** Paste-only (no submit) sibling of `onEngineSendReady`, for the FileTree `a`
   *  mention. Required so a dropped host wire fails typecheck instead of
   *  silently killing `a`. */
  onEnginePasteReady: (paste: (text: string) => boolean) => void
  onDiffTabReady: (open: (relPath: string, label: string, base?: string) => void) => void
  onQuickFork: (repo: string, result: QuickTaskResult) => void
  initialPrompt?: string
  /** The user landed on a tab of the selected task; resolve its episodes. */
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
  // Optional: tests and previews mount no KV provider; no provider = tabs
  // unknown, which mounts.
  const kv = useOptionalKV()
  // `knownTaskTabs` reads a module Map React can't see; without this, closing
  // the last tab leaves TerminalTabs mounted over an empty list it can't survive.
  useAccessor(tabsRevision)
  const engineTabStates = useAccessor(props.orchestrator.engineTabStatesSignal())
  const tasks = useAccessor(props.orchestrator.tasksSignal())
  if (!props.worktree) {
    // Zero tasks = brand-new home: teach instead of pointing at an empty sidebar.
    if (!tasks.some((task) => !task.deletion)) return <WelcomePane />
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg={theme.textMuted}>{t("workspace.empty.selectTask")}</text>
      </box>
    )
  }
  const path = props.worktree
  // Remote (`ssh://`) project: the PTY host spawns locally only and
  // `buildEngineSessionLaunch` refuses. Say so instead of letting the refusal
  // throw through render as an uninformative "This pane crashed".
  const remoteKey = remoteKeyForRepo(props.task?.repo) ?? remoteKeyForRepo(path)
  if (remoteKey) {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg={theme.textMuted}>{t("workspace.empty.remoteUnsupported", { host: remoteKey })}</text>
      </box>
    )
  }
  // KNOWN-empty tabs (last one closed) must not mount TerminalTabs: it would
  // mint a replacement, since its `active` tab is non-null by construction
  // and 17 downstream call sites rely on that. `null` (not mounted since
  // restart) is NOT empty and mounts. Entering the task revives it
  // (`reviveEmptiedTabs`), but this still renders for restart-restored or
  // emptied-on-screen tasks; the pane binds the keys it advertises itself.
  const known = props.task ? knownTaskTabs(kv, String(props.task.id)) : null
  if (known && known.tabs.length === 0 && props.task) {
    return <EmptyWorkspacePane taskId={String(props.task.id)} focused={props.focused} />
  }
  return (
    // The center column IS the engine: an in-process PTY running the real
    // CLI, never re-rendered by Rove. Keyed by TASK, not path: two tasks can
    // share a directory (project-main + dir task), and a path key would carry
    // one task's TabsState into the other's persistKey. PTY reuse is
    // unaffected (registry keys are `taskId::tabId`).
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
        model: props.task?.model,
      })}
      vendor={props.task?.vendor ?? DEFAULT_TASK_VENDOR}
      modelEffort={props.task?.modelEffort}
      onChooseEngine={
        props.task
          ? (vendor) => {
              const taskId = props.task?.id
              if (!taskId) return
              // The tab is added locally first under the new engine's label,
              // so a rejected write would look like success; same two toasts
              // as `v` (applyVendorChange).
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
      // Hook-driven per-tab engine state: the sub-second chip/notification
      // source (polling stays as fallback).
      hookTabStates={props.task ? engineTabStates.get(props.task.id) : undefined}
      taskTitle={props.task?.title}
      onTabVisited={(tabId) => {
        const taskId = props.task?.id
        if (taskId) props.onTabVisited?.(taskId, tabId)
      }}
      // A confirmed ESC interrupt (hook says running, title says rested) is
      // reported as the `turn-interrupted` the engine's abort path never fires.
      onEngineInterrupt={(tabId) => {
        const taskId = props.task?.id
        if (taskId) props.orchestrator.reportEngineInterrupt(taskId, tabId)
      }}
    />
  )
}
