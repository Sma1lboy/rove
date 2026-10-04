/**
 * Mount-once, forever-lived parent handoffs (sibling of `use-tab-lifecycle.ts`):
 * the imperative editor-tab / diff-tab / engine-send handles. Reads go through
 * the caller's `stateRef`/`propsRef` mirrors, writes through `update` (which
 * refreshes `stateRef` synchronously). See TerminalTabs' header for why refs.
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
      readonly onEngineSendReady?: (send: (text: string) => boolean) => void
      readonly onEnginePasteReady?: (paste: (text: string) => boolean) => void
      readonly onDiffTabReady?: (open: (relPath: string, label: string, base?: string) => void) => void
    }
  }
  readonly update: (next: TabsState) => void
  /** The per-tab spawn-opts builder. */
  readonly engineTabSpawnRef: { readonly current: (tab: EngineTab) => TabSpawn }
  readonly bumpResetToken: () => void
}

type EnginePtyIO = Pick<TabHandoffIO, "stateRef" | "propsRef" | "engineTabSpawnRef">

/** The active engine tab, else the first engine tab; a parked background tab is
 *  re-acquired (reattach + replay, then the paste lands). One closure stays
 *  valid for the mount's life because every read is through refs. */
function resolveEnginePty(io: EnginePtyIO): ReturnType<ReturnType<typeof getDefaultPtyRegistry>["get"]> | null {
  const { stateRef, propsRef, engineTabSpawnRef } = io
  const activeTab = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeId)
  const target = activeTab?.kind === "engine" ? activeTab : stateRef.current.tabs.find((t) => t.kind === "engine")
  if (!target) return null
  const reg = getDefaultPtyRegistry()
  const key = tabPtyKey(propsRef.current.taskId, target.id)
  let pty = reg.get(key)
  if (!pty && target.kind === "engine") {
    // Default geometry until next mount; the engine rewraps on the real resize.
    try {
      pty = reg.acquire(key, propsRef.current.worktree, { ...engineTabSpawnRef.current(target) })
    } catch {
      return null
    }
  }
  if (!pty || pty.killed) return null
  return pty
}

/**
 * Paste + submit into the engine tab. FALSE when there's nowhere to deliver
 * (no engine tab, e.g. after ctrl+w on the last one, or a dead PTY that won't
 * respawn); every caller must surface `false`, or the diff review marks notes
 * sent and the mention reports nothing. Exported for the send-vs-paste test.
 */
export function buildEngineSend(io: EnginePtyIO): (text: string) => boolean {
  return (text) => {
    const pty = resolveEnginePty(io)
    if (!pty) return false
    pty.paste(text)
    pty.write("\r")
    return true
  }
}

/** No submit: the FileTree `a` mention leaves `@path` for the user to type
 *  around (docs/TUI.md). */
export function buildEnginePaste(io: EnginePtyIO): (text: string) => boolean {
  return (text) => {
    const pty = resolveEnginePty(io)
    if (!pty) return false
    pty.paste(text)
    return true
  }
}

/**
 * Once per mount (a task/worktree switch remounts). Also returns the closures
 * for direct use (the diff review's send-notes).
 */
export function useTabHandoffs(io: TabHandoffIO): {
  sendToEngine: (text: string) => boolean
  pasteToEngine: (text: string) => boolean
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

  // FileTree `d`: a content swap, NOT a focus grab; the host never calls
  // `focus.setFocused` here, so focus stays on the FileTree.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once handoff; same ref-freshness contract as onEngineSendReady above.
  useEffect(() => {
    propsRef.current.onEnginePasteReady?.(pasteToEngine)
  }, [])

  return { sendToEngine, pasteToEngine }
}
