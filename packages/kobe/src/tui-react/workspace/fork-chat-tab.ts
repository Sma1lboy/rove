/**
 * Fork-this-chat (`chat.tab.fork`): a new tab in the SAME worktree that opens
 * on the active conversation and diverges (`quick-fork.ts` forks the WORKTREE).
 * Only the join: fork flags live in `engineForkArgv`, tab state in `terminal-tabs-core`.
 */

import { engineCanFork, getEngineProtocol, protocolEntry } from "@/engine/engine-presets"
import { engineDisplayName } from "@/engine/interactive-command"
import { buildHandoffPrompt } from "@/engine/session-handoff"
import type { VendorId } from "@/types/vendor"
import {
  type TabsState,
  type TerminalTab,
  addTab,
  setTabEngineCommand,
  setTabForkFrom,
  setTabInitialPrompt,
} from "../../tui/workspace/terminal-tabs-core"

/** What the chord can do; the caller notifies on refusals rather than opening a blank tab. */
export type ChatForkPlan =
  /** Same engine, native fork: it reopens its own conversation and branches. */
  | { readonly kind: "fork"; readonly sessionId: string }
  /** Different engine: starts fresh, briefed to read the source transcript. */
  | { readonly kind: "handoff"; readonly prompt: string }
  /** Nothing to continue from — this tab has no conversation yet. */
  | { readonly kind: "no-session" }
  /** Its engine keeps no transcript kobe can name (kimi, copilot, custom). */
  | { readonly kind: "no-transcript"; readonly engine: string }

/**
 * The protocol the active tab's engine actually SPEAKS. A preset without
 * `engineProtocol.<id>` resolves to an empty entry (no transcript, no fork),
 * so fall back to the process-walk's `EngineTab.liveVendor`. A declared
 * protocol always wins; a live vendor with no protocol of its own adds nothing.
 */
export function liveSourceProtocol(active: TerminalTab, tabVendor: VendorId): VendorId {
  if (getEngineProtocol(tabVendor)) return tabVendor
  const live = active.kind === "engine" ? active.liveVendor : undefined
  return live && getEngineProtocol(live) ? live : tabVendor
}

/**
 * "Continue this chat in `target`": same engine that can branch → native
 * fork; else a HANDOFF, a fresh session briefed with the source transcript's
 * path (`session-handoff.ts`). Transcripts are never converted.
 */
export async function planChatContinuation(
  active: TerminalTab,
  source: VendorId,
  target: VendorId,
  worktree: string,
): Promise<ChatForkPlan> {
  const sessionId = await forkSourceSessionId(active, source, worktree)
  if (!sessionId) return { kind: "no-session" }
  if (target === source && engineCanFork(source)) return { kind: "fork", sessionId }
  const transcriptPath = await protocolEntry(source).history.transcriptPath(sessionId, worktree)
  if (!transcriptPath) return { kind: "no-transcript", engine: engineDisplayName(source) }
  return {
    kind: "handoff",
    prompt: buildHandoffPrompt({ fromEngine: engineDisplayName(source), transcriptPath, worktree }),
  }
}

/** Continue into a child task: native forks are keyed to the source cwd, so
 *  this is ALWAYS a handoff (or refusal). The brief names the source worktree. */
export async function planWorktreeHandoff(
  active: TerminalTab,
  source: VendorId,
  worktree: string,
): Promise<ChatForkPlan> {
  const sessionId = await forkSourceSessionId(active, source, worktree)
  if (!sessionId) return { kind: "no-session" }
  const transcriptPath = await protocolEntry(source).history.transcriptPath(sessionId, worktree)
  if (!transcriptPath) return { kind: "no-transcript", engine: engineDisplayName(source) }
  return {
    kind: "handoff",
    prompt: buildHandoffPrompt({ fromEngine: engineDisplayName(source), transcriptPath, worktree }),
  }
}

/** The tab's pinned session id, else the engine's newest for this worktree
 *  (unpinned tabs, e.g. codex). `listSessionIdsForWorktree` is oldest-first. */
async function forkSourceSessionId(active: TerminalTab, vendor: VendorId, worktree: string): Promise<string | null> {
  if (active.kind !== "engine") return null
  if (active.sessionId) return active.sessionId
  const ids = await protocolEntry(vendor).history.listSessionIdsForWorktree(worktree)
  return ids.at(-1) ?? null
}

/**
 * New tab that LAUNCHES `pick` but speaks `protocol`, forking `sourceSessionId`.
 * They split for a wrapper preset (`claudecpa` runs, claude's fork flags
 * apply), which `EngineTab.engineCommand` vs `vendor` already expresses.
 */
export function addForkTab(state: TabsState, pick: VendorId, protocol: VendorId, sourceSessionId: string): TabsState {
  const next = addTab(state, protocol)
  const launched = pick === protocol ? next : setTabEngineCommand(next, next.activeId, pick)
  return setTabForkFrom(launched, launched.activeId, sourceSessionId)
}

/** New engine tab pinned to `vendor`, opening on the handoff brief. */
export function addHandoffTab(state: TabsState, vendor: VendorId, prompt: string): TabsState {
  const next = addTab(state, vendor)
  return setTabInitialPrompt(next, next.activeId, prompt)
}
