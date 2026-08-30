/**
 * Mount-once parent-handoff effects extracted from `TerminalTabs.tsx` (the
 * ~500-line cap), sibling of `use-tab-lifecycle.ts`: the imperative
 * editor-tab / engine-send handles handed to the parent. Both are
 * mount-only, forever-lived effects — everything they read comes through
 * the caller's `stateRef`/`propsRef` latest-render mirrors, and every write
 * goes through the caller's `update` (which refreshes `stateRef`
 * synchronously). See the TerminalTabs file header for why refs.
 */

import { useEffect } from "react"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import {
  type EngineTab,
  type TabSpawn,
  type TabsState,
  findEditorTab,
  openContentTab,
  openEditorTab,
  tabPtyKey,
} from "../../tui/workspace/terminal-tabs-core"
import { releaseSplitLeaves } from "./TerminalSplit"

export interface TabHandoffIO {
  readonly stateRef: { readonly current: TabsState }
  readonly propsRef: {
    readonly current: {
      readonly taskId: string
      readonly worktree: string
      readonly onEditorTabReady?: (open: (command: readonly string[], label: string) => void) => void
      readonly onEngineSendReady?: (send: (text: string) => void) => void
      readonly onEnginePasteReady?: (paste: (text: string) => void) => void
      readonly onDiffTabReady?: (open: (relPath: string, label: string, base?: string) => void) => void
    }
  }
  readonly update: (next: TabsState) => void
  /** Latest-render mirror of the per-tab spawn-opts builder. */
  readonly engineTabSpawnRef: { readonly current: (tab: EngineTab) => TabSpawn }
  readonly bumpResetToken: () => void
}

type EnginePtyIO = Pick<TabHandoffIO, "stateRef" | "propsRef" | "engineTabSpawnRef">

/** The engine tab's live PTY — the active tab when it's an engine, else the
 *  first engine tab; a parked background tab (issue #28) is re-acquired
 *  (reattach + replay, then the paste lands). Reads everything through the
 *  latest-render refs, so one closure stays valid for the mount's life. */
function resolveEnginePty(io: EnginePtyIO): ReturnType<ReturnType<typeof getDefaultPtyRegistry>["get"]> | null {
  const { stateRef, propsRef, engineTabSpawnRef } = io
  const activeTab = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeId)
  const target = activeTab?.kind === "engine" ? activeTab : stateRef.current.tabs.find((t) => t.kind === "engine")
  if (!target) return null
  const reg = getDefaultPtyRegistry()
  const key = tabPtyKey(propsRef.current.taskId, target.id)
  let pty = reg.get(key)
  if (!pty && target.kind === "engine") {
    // Default geometry until the tab is next mounted; the engine rewraps on
    // the real resize like any terminal.
    try {
      pty = reg.acquire(key, propsRef.current.worktree, { ...engineTabSpawnRef.current(target) })
    } catch {
      return null
    }
  }
  if (!pty || pty.killed) return null
  return pty
}

/** Paste `text` into the task's engine tab PTY and submit. Exported for the
 *  send-vs-paste contract test — the mention must NOT submit. */
export function buildEngineSend(io: EnginePtyIO): (text: string) => void {
  return (text) => {
    const pty = resolveEnginePty(io)
    if (!pty) return
    pty.paste(text)
    pty.write("\r")
  }
}

/** Paste `text` into the task's engine tab PTY WITHOUT submitting — the
 *  FileTree `a` mention leaves the `@path` in the engine's composer for the
 *  user to keep typing around (docs/TUI.md). */
export function buildEnginePaste(io: EnginePtyIO): (text: string) => void {
  return (text) => {
    const pty = resolveEnginePty(io)
    if (!pty) return
    pty.paste(text)
  }
}

/**
 * Hand the parent the editor-tab / engine-send imperative handles once per
 * mount — remounting on task/worktree switch re-fires it. Returns the same
 * engine-send closure so the owning component can use it directly (the diff
 * review's send-notes action).
 */
export function useTabHandoffs(io: TabHandoffIO): {
  sendToEngine: (text: string) => void
  pasteToEngine: (text: string) => void
} {
  const { stateRef, propsRef, update } = io
  const sendToEngine = buildEngineSend(io)
  const pasteToEngine = buildEnginePaste(io)

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once handoff; the callback reads propsRef/stateRef for freshness.
  useEffect(() => {
    propsRef.current.onEditorTabReady?.((command, label) => {
      const current = stateRef.current
      const existing = findEditorTab(current)
      if (existing) {
        const key = tabPtyKey(propsRef.current.taskId, existing.id)
        releaseSplitLeaves(key, existing.splitTree ?? null)
        getDefaultPtyRegistry().release(key)
      }
      update(openEditorTab(current, command, label))
      if (existing?.id === current.activeId) io.bumpResetToken()
    })
  }, [])

  // Read-only diff/preview tab (issue #21): the FileTree `d` action. A
  // content swap, NOT a focus grab — `openContentTab` selects the tab but
  // the host never calls `focus.setFocused` here (KOB-25), so keyboard focus
  // stays on the FileTree that opened it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once handoff; the callback reads propsRef/stateRef for freshness.
  useEffect(() => {
    propsRef.current.onDiffTabReady?.((relPath, label, base) => {
      update(openContentTab(stateRef.current, relPath, label, base))
    })
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once handoff; the callback reads propsRef/stateRef for freshness.
  useEffect(() => {
    propsRef.current.onEngineSendReady?.(sendToEngine)
  }, [])

  // Paste-only sibling (no submit): the FileTree `a` @path mention.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once handoff; same ref-freshness contract as onEngineSendReady above.
  useEffect(() => {
    propsRef.current.onEnginePasteReady?.(pasteToEngine)
  }, [])

  return { sendToEngine, pasteToEngine }
}
