/**
 * Tab-strip dialog flows (F2 rename, the unified new-conversation dialog),
 * kept apart from the places the component acts. No state of its own: the
 * caller rebuilds it every render, so closures read the CURRENT `state`/`active`.
 *
 * `requestNewChat` is the single entry: one `NewChatDialog`, two toggles.
 * A tab destination is a child task sharing this directory (`onSpawnChild`),
 * except for a task's first conversation, which stays its own engine tab:
 *
 *   destination=tab  + context=fresh    → new conversation here (ctrl+e enter,
 *                                         incl. shell / plugin panes as tabs)
 *   destination=tab  + context=continue → fork/handoff child task
 *                                         (`ctrl+a c`)
 *   destination=fork + context=fresh    → QuickTaskComposer child task
 *                                         (`ctrl+a f`)
 *   destination=fork + context=continue → composer, first prompt led by the
 *                                         transcript handoff brief
 *   destination=scratch (fresh only)    → new Scratch task in $HOME, tab-1
 *                                         running the picked engine or shell
 */

import { availableEngineIds } from "@/engine/account-detect"
import { resolveMainRepoRoot } from "@/state/repos"
import { setRepoLastActiveVendor } from "@/state/vendor-prefs"
import type { VendorId } from "@/types/vendor"
import { defaultDaemonSocketPath } from "@sma1lboy/rove-daemon/daemon/paths"
import { type PaneLaunch, listPaneLaunches } from "@sma1lboy/rove-daemon/plugins/pane-command"
import { ROVE_PRODUCT_NAME } from "../../product.ts"
import { getCurrentBranch } from "../../tui/lib/git-snapshot"
import { defaultShell } from "../../tui/panes/terminal/pty-types"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { openPluginPane } from "../../tui/workspace/pane-split"
import {
  type TabsState,
  type TerminalTab,
  addTab,
  openCommandTab,
  renameActiveTab,
  tabPtyKeyFor,
} from "../../tui/workspace/terminal-tabs-core"
import {
  type NewChatChoice,
  type NewChatContext,
  type NewChatDestination,
  NewChatDialog,
} from "../component/new-chat-dialog"
import { QuickTaskComposer, type QuickTaskResult } from "../component/quick-task-composer"
import { RenameTaskDialog } from "../component/rename-task-dialog"
import type { useDialog } from "../ui/dialog"
import {
  type ChatForkPlan,
  addForkTab,
  addHandoffTab,
  engineStarted,
  forkFirstTab,
  liveSourceProtocol,
  planChatContinuation,
  planWorktreeHandoff,
  retargetUnstartedEngine,
  unstartedEngineTab,
} from "./fork-chat-tab"
import { type ChildSpawnRequest, type QuickForkSource, quickForkComposerOptions } from "./quick-fork"
import { tabTitle } from "./tab-strip"

export interface NewChatPreset {
  readonly destination?: NewChatDestination
  readonly context?: NewChatContext
}

export function useTabDialogs(deps: {
  dialog: ReturnType<typeof useDialog>
  t: (key: string, params?: Record<string, string>) => string
  state: TabsState
  active: TerminalTab
  vendor: VendorId
  /** Passed to plugin panes as `ROVE_PLUGIN_TASK_ID`. */
  taskId: string
  worktree: string
  liveTitles: ReadonlyMap<string, string>
  update: (next: TabsState) => void
  pinSession: (s: TabsState, vendor: VendorId | undefined) => TabsState
  /** Active leaf's emulator cells for split-core's size gate (null = unknown). */
  activeLeafSize: () => { cols: number; rows: number } | null
  /** A choice whose vendor is persisted as the task's default (the task's own engine tab). */
  onChooseEngine?: (vendor: VendorId) => void
  /** Absent = new conversations stay tabs (a remote task cannot have local children). */
  onSpawnChild?: (request: ChildSpawnRequest) => void
  onQuickFork?: (repo: string, result: QuickTaskResult, source?: QuickForkSource) => void
  /** Absent = the dialog's "scratch" destination isn't offered. Engine
   *  undefined = a bare shell. */
  onOpenScratch?: (vendor: VendorId | undefined) => void
  /** Toast for the "nothing to continue from" refusals. */
  notifyError: (title: string) => void
}): {
  requestRename: () => void
  requestNewChat: (preset?: NewChatPreset) => void
  /** True when the pick became a child task rather than a tab here. */
  newConversation: (vendor: VendorId) => boolean
} {
  const { dialog, t, state, active, update, pinSession } = deps

  const requestRename = (): void => {
    if (!active) return
    void RenameTaskDialog.show(dialog, tabTitle(active, deps.vendor, deps.liveTitles.get(active.id)), {
      dialogTitle: t("terminal.tab.renameTitle"),
      fieldLabel: t("terminal.tab.renameField"),
      submitLabel: t("terminal.tab.renameSubmit"),
      allowEmpty: true,
    }).then((title) => {
      if (title === undefined) return
      update(renameActiveTab(state, title))
    })
  }

  const notifyRefusal = (plan: ChatForkPlan): void =>
    deps.notifyError(
      plan.kind === "no-transcript"
        ? t("terminal.tab.noTranscriptToHandOff", { engine: plan.engine })
        : t("terminal.tab.nothingToFork"),
    )

  /** A new conversation here; true when it became a child task. The task's first
   *  one runs in its own engine tab; once that has a live PTY or a transcript, another is
   *  a child sharing the directory. No `onSpawnChild` (a remote task) keeps the second tab. */
  const newConversation = (vendor: VendorId): boolean => {
    const isLive = (tab: TerminalTab): boolean => {
      const pty = getDefaultPtyRegistry().get(tabPtyKeyFor(deps.taskId, tab))
      return pty != null && !pty.killed
    }
    if (engineStarted(state, isLive) && deps.onSpawnChild) {
      deps.onSpawnChild({ parentTaskId: deps.taskId, vendor })
      return true
    }
    const unstarted = unstartedEngineTab(state, isLive)
    update(unstarted ? retargetUnstartedEngine(state, unstarted.id, vendor) : pinSession(addTab(state, vendor), vendor))
    return false
  }

  /** Fresh (`newConversation`) or continuing (fork/handoff). Picking the id the tab was
   *  LAUNCHED under (`tabVendor`) continues under its live protocol
   *  (`source`) rather than reading as a handoff to a foreign engine. */
  const openTabHere = async (choice: NewChatChoice, tabVendor: VendorId, source: VendorId): Promise<void> => {
    const vendor = choice.pick as VendorId
    if (choice.context === "continue") {
      const target = vendor === tabVendor ? source : vendor
      const plan = await planChatContinuation(active, source, target, deps.worktree)
      if (plan.kind === "fork") {
        if (deps.onSpawnChild) {
          deps.onSpawnChild({ parentTaskId: deps.taskId, vendor, tabs: forkFirstTab(vendor, target, plan.sessionId) })
        } else update(pinSession(addForkTab(state, vendor, target, plan.sessionId), target))
      } else if (plan.kind === "handoff") {
        if (deps.onSpawnChild) deps.onSpawnChild({ parentTaskId: deps.taskId, vendor, prompt: plan.prompt })
        else update(pinSession(addHandoffTab(state, vendor, plan.prompt), vendor))
      } else notifyRefusal(plan)
      return
    }
    // The task's own default engine changes only when the pick runs in its own tab, never for a child.
    if (!newConversation(vendor)) deps.onChooseEngine?.(vendor)
    try {
      setRepoLastActiveVendor(resolveMainRepoRoot(deps.worktree), vendor)
    } catch {
      /* best-effort: a stale worktree path must not block the new tab */
    }
  }

  /** Child task seeded from THIS task's repo/branch and the picked engine;
   *  with context=continue its first prompt opens on the handoff brief. */
  const forkChildTask = async (
    choice: NewChatChoice,
    source: VendorId,
    engines: readonly VendorId[],
  ): Promise<void> => {
    let repo: string
    try {
      repo = resolveMainRepoRoot(deps.worktree)
    } catch {
      return
    }
    let contextPrompt: string | undefined
    if (choice.context === "continue") {
      const plan = await planWorktreeHandoff(active, source, deps.worktree)
      if (plan.kind !== "handoff") {
        notifyRefusal(plan)
        return
      }
      contextPrompt = plan.prompt
    }
    const vendor = choice.pick as VendorId
    const result = await QuickTaskComposer.show(
      dialog,
      quickForkComposerOptions(repo, engines.length > 0 ? engines : [vendor], vendor, deps.worktree),
    )
    if (result === undefined) return
    deps.onQuickFork?.(repo, contextPrompt ? { ...result, prompt: `${contextPrompt}\n\n${result.prompt}` } : result, {
      taskId: deps.taskId,
      branch: getCurrentBranch(deps.worktree),
    })
  }

  /** `ctrl+e` opens it pristine; `ctrl+a c` / `ctrl+a f` pre-flip a toggle. */
  const requestNewChat = (preset: NewChatPreset = {}): void => {
    void (async () => {
      const tabVendor = (active.kind === "engine" ? active.vendor : undefined) ?? deps.vendor
      const source = liveSourceProtocol(active, tabVendor)
      const available = await availableEngineIds()
      // Plugin panes ride the picker too ("what runs in this tab"). A
      // synchronous read of a few small registry files; the dialog shows them
      // only in the default combo.
      let panes: PaneLaunch[] = []
      try {
        panes = listPaneLaunches({
          socketPath: defaultDaemonSocketPath(),
          binPath: ROVE_PRODUCT_NAME,
          taskId: deps.taskId,
        })
      } catch {
        /* registry unreadable → engines only */
      }
      const choice = await NewChatDialog.show(
        dialog,
        available,
        // Continue-presets highlight the tab's own engine; pristine keeps
        // the task engine.
        preset.context === "continue" ? tabVendor : deps.vendor,
        {
          allowShell: true,
          allowScratch: deps.onOpenScratch !== undefined,
          extraChoices: panes.map((p) => ({ key: `pane:${p.pluginId}.${p.paneId}`, label: p.title })),
          initialDestination: preset.destination,
          initialContext: preset.context,
        },
      )
      if (choice === undefined) return
      if (choice.destination === "fork") {
        await forkChildTask(choice, source, available)
        return
      }
      // A whole Scratch TASK, not a tab; this is its only entry point.
      if (choice.destination === "scratch") {
        deps.onOpenScratch?.(choice.pick === "shell" ? undefined : (choice.pick as VendorId))
        return
      }
      const pane = panes.find((p) => `pane:${p.pluginId}.${p.paneId}` === choice.pick)
      if (pane) {
        update(openPluginPane(state, pane.argv, pane.title, pane.placement, undefined, deps.activeLeafSize()))
        return
      }
      // Plain terminal tab: no session pin, no vendor-preference write, closes
      // on exit; null label so the live process names it ("zsh", "vim").
      if (choice.pick === "shell") {
        update(openCommandTab(state, [defaultShell()], null))
        return
      }
      await openTabHere(choice, tabVendor, source)
    })()
  }

  return { requestRename, requestNewChat, newConversation }
}
