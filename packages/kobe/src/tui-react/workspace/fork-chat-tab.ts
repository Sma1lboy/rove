/**
 * Fork-this-chat (`chat.tab.fork`): a new tab in the SAME worktree that
 * opens on the active tab's conversation and then diverges — the sibling of
 * `quick-fork.ts`, which forks the WORKTREE into a child task.
 *
 * Its own module because it is only the JOIN: the vendor-specific launch
 * flags live in the engine layer (`engineForkArgv`) and the tab-state
 * transition in `terminal-tabs-core`, so the fork gesture owns neither, and
 * keeping it thin is what stops either of them leaking into the component.
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

/** What the chord can actually do here — the caller notifies on the
 *  refusals instead of silently opening a blank tab (which is what a
 *  fork-less engine would otherwise get). */
export type ChatForkPlan =
  /** Same engine, native fork: it reopens its own conversation and branches. */
  | { readonly kind: "fork"; readonly sessionId: string }
  /** Different engine: it starts fresh, briefed to read the old transcript. */
  | { readonly kind: "handoff"; readonly prompt: string }
  /** Nothing to continue from — this tab has no conversation yet. */
  | { readonly kind: "no-session" }
  /** There IS a conversation, but its engine keeps no transcript kobe can
   *  name (kimi, copilot, custom), so there is nothing to hand over. */
  | { readonly kind: "no-transcript"; readonly engine: string }

/**
 * The protocol the active tab's engine actually SPEAKS, which is not always
 * the id it was launched under.
 *
 * A custom preset registered without `engineProtocol.<id>` (the shape every
 * pre-`engineProtocol` preset has on disk) resolves to the empty custom
 * registry entry: no transcript reader, no fork verb — so a `claudecpa` tab
 * that has been talking to claude all along reported "nothing to continue"
 * (owner report 2026-09-02). The process-tree walk already answered this
 * question and recorded it as `EngineTab.liveVendor`; this is the join.
 *
 * Evidence, never a default. A declared protocol (built-in, contrib, or a
 * preset that named one) is authoritative and wins; a live vendor that names
 * no protocol of its own is no better than the id we started with.
 */
export function liveSourceProtocol(active: TerminalTab, tabVendor: VendorId): VendorId {
  if (getEngineProtocol(tabVendor)) return tabVendor
  const live = active.kind === "engine" ? active.liveVendor : undefined
  return live && getEngineProtocol(live) ? live : tabVendor
}

/**
 * Resolve "continue this chat in `target`" to one outcome.
 *
 * Same engine that can branch → a real fork (both sides keep full context
 * natively). Anything else → a HANDOFF: the target engine starts a fresh
 * session briefed with the source transcript's path, the format-agnostic
 * approach Orca uses (see `session-handoff.ts`). No transcript conversion
 * is ever attempted.
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

/**
 * "Continue this conversation" for the FORK destination (issue #7): the
 * child task runs in a NEW worktree, and engine-native session forks are
 * keyed to the source cwd — so this is ALWAYS a handoff (or a refusal),
 * never `{ kind: "fork" }`. The brief names the source worktree, which is
 * where the transcript's work actually happened.
 */
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

/**
 * Session id the fork should open on: the tab's OWN pinned id when it has
 * one (claude tabs kobe launched itself), else the newest session the
 * engine recorded for this worktree — codex tabs and pre-`--session-id`
 * rehydrated tabs have no pin, and the engine's own transcript store is the
 * only source of truth for what conversation this tab is showing.
 * `listSessionIdsForWorktree` is oldest-first, so the fork source is last.
 */
export async function forkSourceSessionId(
  active: TerminalTab,
  vendor: VendorId,
  worktree: string,
): Promise<string | null> {
  if (active.kind !== "engine") return null
  if (active.sessionId) return active.sessionId
  const ids = await protocolEntry(vendor).history.listSessionIdsForWorktree(worktree)
  return ids.at(-1) ?? null
}

/**
 * New engine tab that LAUNCHES `pick` but speaks `protocol`, marked as a fork
 * of `sourceSessionId`.
 *
 * The two split for a wrapper preset: the user picked `claudecpa` and the new
 * tab must still run it (its zsh function passes `"$@"` through), while every
 * session verb `engineTabArgv` reaches for — the fork flags above all — is
 * claude's. `EngineTab.engineCommand` already means exactly that ("wins over
 * `vendor` at spawn; `vendor` then carries the protocol kobe resolved for
 * it"), so pinning the pick there is what keeps the launch honest.
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
