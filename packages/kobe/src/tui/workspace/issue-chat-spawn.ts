/**
 * Kanban "Start" spawns: fed to `PtyRegistry.acquire` so the engine LAUNCHES
 * now, not on first visit (placement grammar: `state/issue-chat.ts`).
 *
 * Mirrors `TerminalTabs`' first-tab spawn exactly (`initialTabs()` + pinned
 * session id + `engineTabSpawnFor`) so a later visit ATTACHES to the same
 * `tabPtyKey`. `tabsSnapshot` (spawned=true), written to
 * `terminalTabs.<taskId>`, makes the visit rehydrate onto this session and
 * `--resume` it after a host restart.
 */

import { withPinnedSessionId } from "@/engine/engine-presets"
import { interactiveEngineCommand } from "@/engine/interactive-command"

import type { VendorId } from "@/types/vendor"
import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { issueWorktreePrompt } from "../../state/issue-chat"
import { defaultShell } from "../panes/terminal/pty-types"
import {
  type EngineTab,
  type TabsState,
  engineTabSpawnFor,
  initialTabs,
  setTabSpawned,
  tabPtyKey,
} from "./terminal-tabs-core"

export interface IssueChatBackgroundSpawn {
  /** Registry key for the task's first engine tab (`taskId::tab-1`). */
  readonly ptyKey: string
  readonly command: readonly string[]
  readonly initialInput?: string
  /** Paste-delivery vendor (kimi): the prompt is pasted post-spawn, not in argv. */
  readonly firstMessage?: string
  /** Engine binary name for the first-message engine-up probe. */
  readonly engineBin?: string
  /** Persist to `terminalTabsKey(taskId)` so a visit attaches, not respawns. */
  readonly tabsSnapshot: TabsState
}

/** Compose the headless first-tab engine launch for a story's new task. */
export function buildIssueChatBackgroundSpawn(input: {
  issue: Issue
  taskId: string
  repoRoot: string
  worktreePath: string
  vendor: VendorId
  /** Shell-ready `kobe api` prefix for the prompt's status protocol. */
  api: string
  shell?: string
}): IssueChatBackgroundSpawn {
  const base = interactiveEngineCommand(input.vendor)
  const { sessionId } = withPinnedSessionId(base, input.vendor)
  const fresh = initialTabs()
  const tab: EngineTab = { ...(fresh.tabs[0] as EngineTab), sessionId }
  const state: TabsState = { ...fresh, tabs: [tab] }
  const spawn = engineTabSpawnFor(state, tab, base, {
    live: false,
    shell: input.shell ?? defaultShell(),
    prompt: issueWorktreePrompt(input.issue, input.api),
    task: { id: input.taskId, kind: "task", vendor: input.vendor, repo: input.repoRoot },
    worktreePath: input.worktreePath,
  })
  return {
    ptyKey: tabPtyKey(input.taskId, tab.id),
    command: spawn.command,
    initialInput: spawn.initialInput,
    firstMessage: spawn.firstMessage,
    engineBin: spawn.engineBin,
    tabsSnapshot: setTabSpawned(state, tab.id, true),
  }
}

/**
 * `project` placement: a story tab APPENDED to an existing task. `tab` is
 * persisted spawned=true (`appendBackgroundEngineTab`), so compose from its
 * unspawned view (fresh `--session-id`, prompt) in a SYNTHETIC one-tab state
 * that passes the first-tab prompt policy (the real tab-1 already spawned).
 */
export function buildIssueTabSpawn(input: {
  /** The task hosting the tab (the repo's main task) + its checkout. */
  taskId: string
  repoRoot: string
  worktreePath: string
  tab: EngineTab
  vendor: VendorId
  prompt: string
  shell?: string
}): {
  readonly ptyKey: string
  readonly command: readonly string[]
  readonly firstMessage?: string
  readonly engineBin?: string
} {
  const base = interactiveEngineCommand(input.vendor)
  const fresh: EngineTab = { ...input.tab, spawned: false }
  const synthetic: TabsState = { tabs: [fresh], activeId: fresh.id, nextOrdinal: fresh.ordinal + 1 }
  const spawn = engineTabSpawnFor(synthetic, fresh, base, {
    live: false,
    shell: input.shell ?? defaultShell(),
    prompt: input.prompt,
    task: { id: input.taskId, kind: "main", vendor: input.vendor, repo: input.repoRoot },
    worktreePath: input.worktreePath,
  })
  return {
    ptyKey: tabPtyKey(input.taskId, fresh.id),
    command: spawn.command,
    firstMessage: spawn.firstMessage,
    engineBin: spawn.engineBin,
  }
}
