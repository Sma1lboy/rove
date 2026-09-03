/** Imperative tab-handle wiring for the workspace host.
 *
 * TerminalTabs re-hands its open/send/diff callbacks on every mount;
 * FileTree and keybindings read them at click/keypress time. Keeping the
 * refs, the identity guard, and the FileTree/PR actions together lets
 * `host.tsx` treat the whole bundle as one concern. */

import { useRef } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import type { FocusContextValue } from "../context/focus"
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
  /** Enter a task — the row-aimed actions below need its engine mounted. */
  activateTask: (taskId: string) => void
}

export interface UseEditorHandlesResult {
  onEditorTabReady: (open: (command: readonly string[], label: string) => void) => void
  onEngineSendReady: (send: (text: string) => void) => void
  onEnginePasteReady: (paste: (text: string) => void) => void
  onDiffTabReady: (open: (relPath: string, label: string, base?: string) => void) => void
  onOpenFile: (relPath: string) => void
  onOpenDiff: (relPath: string, base?: string) => void
  onCreatePR: () => void
  /** Sidebar row menu "Fix failing checks" (and the proposed prefix+k) —
   *  enters the row when it is not already active, then pastes the failing
   *  job's log into its engine. */
  onFixChecks: (taskId: string) => void
  /** FileTree `a` — paste `@<path>` into the engine's composer WITHOUT
   *  submitting (docs/TUI.md); the user keeps typing around it. */
  onMention: (relPath: string) => void
}

/** The `@<path>` mention shape the FileTree `a` key pastes into the engine's
 *  composer (docs/TUI.md) — a worktree-relative path, matching the
 *  keybinding row's documented "Inject @<path> mention" contract. */
export function mentionText(relPath: string): string {
  return `@${relPath}`
}

/** React-free core of the FileTree `a` action (sibling of `createPRAction`):
 *  paste `@<path>` into the engine's composer, never submit. Reads the ref at
 *  call time — TerminalTabs re-hands the paste closure on every mount, and a
 *  task with no live engine tab leaves it null (the key is then inert, which
 *  is the pre-existing "no engine, nothing to mention" state). */
export function mentionAction(pasteToEngineFn: {
  readonly current: ((text: string) => void) | null
}): (relPath: string) => void {
  return (relPath) => {
    pasteToEngineFn.current?.(mentionText(relPath))
  }
}

export function useEditorHandles(opts: UseEditorHandlesOpts): UseEditorHandlesResult {
  const { orchestrator, worktree, selectedId, focus, notifyError, activateTask } = opts

  // Imperative handle from the currently-mounted TerminalTabs: a ref, since
  // FileTree's "open" only READS it at click time and
  // TerminalTabs re-hands it on every mount (task/worktree switch).
  const openEditorTabFn = useRef<((command: readonly string[], label: string) => void) | null>(null)
  const sendToEngineFn = useRef<((text: string) => void) | null>(null)
  // Paste-only sibling of sendToEngineFn (no submit) — the FileTree `a` @path
  // mention, handed up through the same TerminalTabs mount-once contract.
  const pasteToEngineFn = useRef<((text: string) => void) | null>(null)
  // Read-only diff tab opener — same ref pattern as the editor tab:
  // TerminalTabs re-hands it per mount, FileTree's `d` reads it at keypress.
  // Opening is a content swap; the host does NOT focus the workspace here — a
  // read-only open must not pull focus.
  const openDiffTabFn = useRef<((relPath: string, label: string, base?: string) => void) | null>(null)

  // Identity guard for the async actions below: after an await, the selected
  // task (and therefore the TerminalTabs mount behind the imperative refs) may
  // have changed — a stale continuation must not deliver into the new task.
  const selectedWorktreeRef = useLatest(worktree)

  // FileTree `pr` chip + prefix+p — own module for the guard above, which its
  // awaits also need.
  const createPR = useCreatePR({ worktree, sendToEngineFn, selectedWorktreeRef, notifyError })

  // Sidebar row menu "Fix failing checks" — same module shape and same park
  // slot as create-PR, because it has the same two hazards (a long await, and
  // a row that may not be the active task).
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

  // FileTree's Enter (editor/plugin/OS) and `d` (read-only diff tab).
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
      // A `prefix+p` aimed at a sidebar row that was not the active task
      // activated it and parked the request; this mount is the first moment
      // the prompt can actually be sent, so claim it here.
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
      // Already the active task → the send closure is live, run it now.
      // Otherwise park it and enter the row: `onEngineSendReady` claims the
      // parked request once that task's TerminalTabs has mounted.
      if (taskId === selectedId) return void fixCI(taskId)
      requestFixCI(taskId)
      activateTask(taskId)
    },
    onMention: mentionAction(pasteToEngineFn),
  }
}
