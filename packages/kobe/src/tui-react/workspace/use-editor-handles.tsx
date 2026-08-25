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
import { useCreatePR } from "./use-create-pr"
import { useFileOpenActions } from "./use-file-open-actions"

export interface UseEditorHandlesOpts {
  orchestrator: RemoteOrchestrator
  worktree: string | null
  selectedId: string | null
  focus: FocusContextValue
  notifyError: (msg: string) => void
}

export interface UseEditorHandlesResult {
  onEditorTabReady: (open: (command: readonly string[], label: string) => void) => void
  onEngineSendReady: (send: (text: string) => void) => void
  onDiffTabReady: (open: (relPath: string, label: string, base?: string) => void) => void
  onOpenFile: (relPath: string) => void
  onOpenDiff: (relPath: string, base?: string) => void
  onCreatePR: () => void
}

export function useEditorHandles(opts: UseEditorHandlesOpts): UseEditorHandlesResult {
  const { orchestrator, worktree, selectedId, focus, notifyError } = opts

  // Imperative handle from the currently-mounted TerminalTabs (issue #16):
  // a ref, since FileTree's "open" only READS it at click time and
  // TerminalTabs re-hands it on every mount (task/worktree switch).
  const openEditorTabFn = useRef<((command: readonly string[], label: string) => void) | null>(null)
  const sendToEngineFn = useRef<((text: string) => void) | null>(null)
  // Read-only diff tab opener (issue #21) — same ref pattern as the editor
  // tab: TerminalTabs re-hands it per mount, FileTree's `d` reads it at
  // keypress. Opening is a content swap; the host does NOT focus the
  // workspace here (KOB-25 — a read-only open must not pull focus).
  const openDiffTabFn = useRef<((relPath: string, label: string, base?: string) => void) | null>(null)

  // Identity guard for the async actions below: after an await, the selected
  // task (and therefore the TerminalTabs mount behind the imperative refs) may
  // have changed — a stale continuation must not deliver into the new task.
  const selectedWorktreeRef = useLatest(worktree)

  // FileTree `pr` chip + prefix+p — split out for the file-size cap.
  const createPR = useCreatePR({ worktree, sendToEngineFn, selectedWorktreeRef, notifyError })

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
    },
    onDiffTabReady: (open) => {
      openDiffTabFn.current = open
    },
    onOpenFile: openFileInEditor,
    onOpenDiff: openDiff,
    onCreatePR: () => void createPR(),
  }
}
