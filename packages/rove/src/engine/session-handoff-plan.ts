/**
 * Planning a conversation's continuation in another (or the same) engine:
 * native fork when the engine can branch, else a handoff brief
 * (`session-handoff.ts`). Shared by the TUI, the web bridge and `rove api`, so
 * every entry point sends the same text. Only the tab's conversation facts
 * are read, never its UI state.
 */

import type { VendorId } from "@/types/vendor"
import { engineCanFork, getEngineProtocol, protocolEntry } from "./engine-presets"
import { engineDisplayName } from "./interactive-command"
import { buildHandoffPrompt, handoffContext } from "./session-handoff"

/** The slice of a terminal tab a continuation reads; any `TerminalTab` fits. */
export interface HandoffSourceTab {
  readonly kind: string
  readonly sessionId?: string | null
  readonly liveVendor?: string | null
  readonly vendor?: string
}

/** What a continuation can do; the caller notifies on refusals rather than opening a blank tab. */
export type ChatForkPlan =
  /** Same engine, native fork: it reopens its own conversation and branches. */
  | { readonly kind: "fork"; readonly sessionId: string }
  /** Different engine: starts fresh, briefed with the source transcript. */
  | { readonly kind: "handoff"; readonly prompt: string }
  /** Nothing to continue from — this tab has no conversation yet. */
  | { readonly kind: "no-session" }
  /** Its engine keeps no transcript rove can name (kimi, copilot, custom). */
  | { readonly kind: "no-transcript"; readonly engine: string }

/**
 * The protocol the active tab's engine actually SPEAKS. A preset without
 * `engineProtocol.<id>` resolves to an empty entry (no transcript, no fork),
 * so fall back to the process-walk's `EngineTab.liveVendor`. A declared
 * protocol always wins; a live vendor with no protocol of its own adds nothing.
 */
export function liveSourceProtocol(active: HandoffSourceTab, tabVendor: VendorId): VendorId {
  if (getEngineProtocol(tabVendor)) return tabVendor
  const live = active.kind === "engine" ? active.liveVendor : undefined
  return live && getEngineProtocol(live) ? live : tabVendor
}

/**
 * "Continue this chat in `target`": same engine that can branch → native
 * fork; else a HANDOFF, a fresh session briefed with the source transcript's
 * path and a bounded excerpt of it. Transcripts are never converted.
 */
export async function planChatContinuation(
  active: HandoffSourceTab,
  source: VendorId,
  target: VendorId,
  worktree: string,
  taskTitle?: string,
): Promise<ChatForkPlan> {
  if (target === source && engineCanFork(source)) {
    const sessionId = await forkSourceSessionId(active, source, worktree)
    return sessionId ? { kind: "fork", sessionId } : { kind: "no-session" }
  }
  return planWorktreeHandoff(active, source, worktree, taskTitle)
}

/** Continue into a child task: native forks are keyed to the source cwd, so
 *  this is ALWAYS a handoff (or refusal). The brief names the source worktree. */
export async function planWorktreeHandoff(
  active: HandoffSourceTab,
  source: VendorId,
  worktree: string,
  taskTitle?: string,
): Promise<ChatForkPlan> {
  const sessionId = await forkSourceSessionId(active, source, worktree)
  if (!sessionId) return { kind: "no-session" }
  const { history } = protocolEntry(source)
  const transcriptPath = await history.transcriptPath(sessionId, worktree)
  if (!transcriptPath) return { kind: "no-transcript", engine: engineDisplayName(source) }
  // Best effort: a reader that throws leaves the path-only brief.
  const context = handoffContext(await history.readHistory(sessionId).catch(() => []))
  return {
    kind: "handoff",
    prompt: buildHandoffPrompt({
      fromEngine: engineDisplayName(source),
      transcriptPath,
      worktree,
      ...(taskTitle ? { taskTitle } : {}),
      ...context,
    }),
  }
}

/** The tab's pinned session id, else the engine's newest for this worktree
 *  (unpinned tabs, e.g. codex). `listSessionIdsForWorktree` is oldest-first. */
async function forkSourceSessionId(
  active: HandoffSourceTab,
  vendor: VendorId,
  worktree: string,
): Promise<string | null> {
  if (active.kind !== "engine") return null
  if (active.sessionId) return active.sessionId
  const ids = await protocolEntry(vendor).history.listSessionIdsForWorktree(worktree)
  return ids.at(-1) ?? null
}
