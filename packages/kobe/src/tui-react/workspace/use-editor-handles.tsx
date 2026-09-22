/** Imperative tab-handle wiring for the workspace host. TerminalTabs re-hands
 * its open/send/diff callbacks every mount; FileTree and keybindings read them
 * at click/keypress time. */

import { useRef } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import type { FocusContextValue } from "../context/focus"
import { useT } from "../i18n"
import { useLatest } from "../lib/use-latest"
import { takeCreatePR, useCreatePR } from "./use-create-pr"
import { useFileOpenActions } from "./use-file-open-actions"
import { requestFixCI, takeFixCI, useFixCI } from "./use-fix-ci"

export interface UseEditorHandlesOpts {
  orchestrator: RemoteOrchestrator
  worktree: string | null
  selectedId: string | null
  focus: FocusContextValue
  notifyError: (msg: string) => void
  /** Row-aimed actions below need the task's engine mounted. */
  activateTask: (taskId: string) => void
}

export interface UseEditorHandlesResult {
  onEditorTabReady: (open: (command: readonly string[], label: string) => void) => void
  onEngineSendReady: (send: (text: string) => boolean) => void
  onEnginePasteReady: (paste: (text: string) => boolean) => void
  onDiffTabReady: (open: (relPath: string, label: string, base?: string) => void) => void
  onOpenFile: (relPath: string) => void
  onOpenDiff: (relPath: string, base?: string) => void
  onCreatePR: () => void
  /** Row menu "Fix failing checks" (and proposed prefix+k): enters the row if
   *  not active, then pastes the failing job's log into its engine. */
  onFixChecks: (taskId: string) => void
  /** FileTree `a`: paste `@<path>` WITHOUT submitting (docs/TUI.md). */
  onMention: (relPath: string) => void
}

/** Worktree-relative, per the keybinding row's "Inject @<path> mention" contract. */
export function mentionText(relPath: string): string {
  return `@${relPath}`
}

/** React-free core of FileTree `a`; reads the ref at call time (re-handed each
 *  mount). A null ref (not mounted yet) or a `false` paste (no engine tab)
 *  calls `onRefused` instead of being a dead key. */
export function mentionAction(
  pasteToEngineFn: {
    readonly current: ((text: string) => boolean) | null
  },
  onRefused: () => void,
): (relPath: string) => void {
  return (relPath) => {
    const paste = pasteToEngineFn.current
    if (!paste || !paste(mentionText(relPath))) onRefused()
  }
}

export function useEditorHandles(opts: UseEditorHandlesOpts): UseEditorHandlesResult {
  const { orchestrator, worktree, selectedId, focus, notifyError, activateTask } = opts
  const t = useT()

  // Refs: TerminalTabs re-hands these per mount; readers only read at action time.
  const openEditorTabFn = useRef<((command: readonly string[], label: string) => void) | null>(null)
  const sendToEngineFn = useRef<((text: string) => boolean) | null>(null)
  const pasteToEngineFn = useRef<((text: string) => boolean) | null>(null)
  // The diff opener never focuses the workspace: a read-only open must not pull focus.
  const openDiffTabFn = useRef<((relPath: string, label: string, base?: string) => void) | null>(null)

  // After an await the selected task (and the mount behind the refs) may have
  // changed; a stale continuation must not deliver into the new task.
  const selectedWorktreeRef = useLatest(worktree)

  // FileTree `pr` chip + prefix+p.
  const createPR = useCreatePR({ worktree, sendToEngineFn, selectedWorktreeRef, notifyError })

  // Same shape and park slot as create-PR: same hazards (a long await, a row
  // that may not be active).
  const fixCI = useFixCI({
    worktree,
    sendToEngineFn,
    selectedWorktreeRef,
    notifyError,
    getTask: (taskId) => {
      const task = orchestrator.getTask(taskId)
      return task
        ? { branch: task.branch, ...(task.prStatus?.number === undefined ? {} : { prNumber: task.prStatus.number }) }
        : null
    },
    fetchChecks: (taskId) => orchestrator.failingChecks(taskId),
  })

  const { openFileInEditor, openDiff } = useFileOpenActions({
    orch: orchestrator,
    worktree,
    selectedId,
    focus,
    openEditorTabFn,
    openDiffTabFn,
    selectedWorktreeRef,
  })

  return {
    onEditorTabReady: (open) => {
      openEditorTabFn.current = open
    },
    onEngineSendReady: (send) => {
      sendToEngineFn.current = send
      // First moment a parked request (aimed at a then-inactive row) can send.
      if (takeCreatePR(selectedId)) void createPR()
      const parked = takeFixCI(selectedId)
      if (parked) void fixCI(parked)
    },
    onEnginePasteReady: (paste) => {
      pasteToEngineFn.current = paste
    },
    onDiffTabReady: (open) => {
      openDiffTabFn.current = open
    },
    onOpenFile: openFileInEditor,
    onOpenDiff: openDiff,
    onCreatePR: () => void createPR(),
    onFixChecks: (taskId) => {
      // Active → the send closure is live. Otherwise park and enter the row;
      // `onEngineSendReady` claims it once that task's TerminalTabs mounts.
      if (taskId === selectedId) return void fixCI(taskId)
      requestFixCI(taskId)
      activateTask(taskId)
    },
    onMention: mentionAction(pasteToEngineFn, () => notifyError(t("files.mentionNoEngine"))),
  }
}
