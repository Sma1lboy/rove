/**
 * Spawn composition for an engine tab: argv (session pin / resume / fork)
 * plus the shell-wrapped launch. Vendor knowledge stays here, not in
 * `terminal-tabs-core.ts` (which re-exports this); the type-only imports
 * back from core are erased, so the cycle is cosmetic.
 */

import {
  type EngineSessionLaunchTask,
  type EngineSessionProtocolGates,
  buildEngineSessionLaunch,
} from "@/engine/session-launch"
import { trustEngineWorktree } from "@/engine/trust-worktree"
import { engineForkArgv, engineResumeArgv, withPinnedSessionId } from "../../engine/engine-presets"

import type { VendorId } from "../../types/vendor"
import type { TabSpawn } from "./terminal-tab-spawn"
import type { EngineTab, TabsState, TerminalTab } from "./terminal-tabs-core"

/**
 * `base` = the tab's engine command; `live` = its PTY exists in the registry;
 * `fallbackVendor` = the task's engine when the tab pinned none.
 *
 * Fork tab, first spawn only → opens on the source's history. No session id
 * → bare command. Spawned but not live (host restart, degrade re-acquire) →
 * resume. Otherwise → pin the id fresh. Flag shapes come from the engine's
 * `sessionIdentity`.
 */
export function engineTabArgv(
  tab: EngineTab,
  base: readonly string[],
  live: boolean,
  fallbackVendor?: VendorId,
): readonly string[] {
  if (tab.forkFrom && !tab.spawned && !live) {
    // Fork tabs always pin a vendor; guard so an inherited one never gets claude's flags.
    const forked = tab.vendor ? engineForkArgv(base, tab.vendor, tab.forkFrom, tab.sessionId ?? null) : null
    if (forked) return forked
  }
  if (!tab.sessionId) return base
  const vendor = tab.vendor ?? fallbackVendor
  // Reopen with the engine's declared verb (claude `--resume`, kimi `-S`,
  // codex `resume`). No verb → bare command, not a flag that kills the launch.
  if (tab.spawned && !live) return engineResumeArgv(base, vendor, tab.sessionId) ?? base
  // Re-pin only where the engine accepts a caller-set id (kimi's is
  // discovered from its store; its CLI can't take it as a pin).
  return withPinnedSessionId(base, vendor, () => tab.sessionId as string).argv
}

/**
 * {@link engineTabArgv} wrapped in the user's shell, plus prompt policy:
 * the task `prompt` is delivered ONLY on the first engine tab's first spawn
 * (not spawned, not live), so re-render churn can't re-deliver it. IO reads
 * (`live`, `prompt`, `shell`) come from the caller.
 */
export function engineTabSpawnFor(
  state: TabsState,
  tab: EngineTab,
  base: readonly string[],
  opts: {
    live: boolean
    shell: string
    prompt?: string
    task: EngineSessionLaunchTask
    worktreePath: string
    protocolGates?: EngineSessionProtocolGates
  },
): TabSpawn {
  const { live, shell, prompt } = opts
  const firstEngine = state.tabs.find((t) => t.kind === "engine")
  const fresh = !tab.spawned && !live
  // A tab-owned prompt (cross-engine handoff brief) wins over the task one.
  const tabPrompt = fresh ? tab.initialPrompt?.trim() : undefined
  const wantsPrompt = !!prompt && tab.id === firstEngine?.id && fresh
  const isFreshFirstEngine = tab.id === firstEngine?.id && fresh
  // Tab prompts stay "explicit"; the task prompt exists only on a fresh
  // worktree task (quick-fork, issue-chat), so it's "new-task" and gets the
  // branch-rename coda.
  const promptIntent = tabPrompt
    ? ({ kind: "explicit", prompt: tabPrompt } as const)
    : wantsPrompt
      ? ({ kind: "new-task", prompt } as const)
      : isFreshFirstEngine
        ? ({ kind: "repo-init" } as const)
        : ({ kind: "none" } as const)
  // A viewport tab (EngineTab.ptyTask) launches AS the referenced task's
  // first tab, so activity, hooks and resume belong to that task.
  const ref = tab.ptyTask
  // A hosted session can't answer a trust dialog; pre-trust. Tab vendor wins.
  trustEngineWorktree(tab.vendor ?? opts.task.vendor, ref?.worktree ?? opts.worktreePath)
  const launch = buildEngineSessionLaunch({
    task: ref ? { ...opts.task, id: ref.id, kind: "task" } : opts.task,
    worktreePath: ref?.worktree ?? opts.worktreePath,
    shell,
    argv: engineTabArgv(tab, base, live, opts.task.vendor),
    promptIntent,
    protocolGates: opts.protocolGates,
    // No firstMessageDelivery override: a paste vendor's (kimi) message
    // returns as `launch.firstMessage` (its positional slot is a subcommand)
    // and the hosted backend pastes it post-spawn (`pastePromptWhenEngineUp`).
    // tabId is exported into the launch env so `kobe hook` attributes
    // activity to THIS tab; cwd can't (tabs share the worktree).
    tabId: ref ? "tab-1" : tab.id,
  })
  return {
    command: launch.command,
    ...(launch.firstMessage ? { firstMessage: launch.firstMessage, engineBin: base[0] } : {}),
  }
}

export type TabExitAction = "close" | "resume"

/**
 * ACTIVE tab exit policy. Engines run inside the user's shell, so a live exit
 * means the shell ended → close. An engine tab dead ON ATTACH (host restart,
 * park-sweep corpse) with a session gets ONE resume; `resumeTried` stops a
 * dying `--resume` from respawning forever.
 */
export function tabExitAction(tab: TerminalTab, deadOnAttach: boolean, resumeTried: boolean): TabExitAction {
  if (tab.kind === "engine" && deadOnAttach && !!tab.sessionId && tab.spawned && !resumeTried) return "resume"
  return "close"
}
