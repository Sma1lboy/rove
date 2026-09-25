/** @jsxImportSource @opentui/react */
/**
 * Workspace terminal tabs. Every tab runs the user's SHELL in its own PTY
 * (key `${taskId}::${tabId}`) with the engine command TYPED into it
 * (`shellSpawn`). ctrl+t opens the preferred engine; ctrl+e prompts for one,
 * pins it via `TerminalTab.vendor`, and records it as the project default.
 * Chords: ctrl+t new · ctrl+e new-with-engine · ctrl+w close · F2 rename ·
 * ctrl+]/[ cycle. Tab state lives in `terminal-tabs-shared.ts` (shared with
 * non-mounted writers), so task switches preserve tabs.
 *
 * Freshness rule: `update()` refreshes `stateRef` SYNCHRONOUSLY, because the
 * hydration `Promise.all` and the naming-poll loop issue several updates in
 * one tick; a destructured `state` would clobber earlier ones. `propsRef`
 * does the same for the two mount-only effects (naming poll, hydration
 * verification). `on*Ready` hand their callback to the parent once per mount.
 */

import { engineLaunchArgv, withPinnedSessionId } from "@/engine/engine-presets"

import { getCapabilities } from "@/engine/registry"
import { resolveMainRepoRoot } from "@/state/repos"
import { resolvePreferredVendor } from "@/state/vendor-prefs"
import type { VendorId } from "@/types/vendor"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { prefixAction } from "../../tui/lib/keymap-dispatch"
import { buildDiffReview } from "../../tui/ops/diff-comments"
import { warmHostedShell } from "../../tui/panes/terminal/pty-hosted"
import { defaultShell } from "../../tui/panes/terminal/pty-types"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { shellIdentityInput } from "../../tui/workspace/terminal-tab-spawn"
import {
  type EngineTab,
  type TabSpawn,
  type TabsState,
  addTab,
  cycleTab,
  engineTabSpawnFor,
  gotoTab,
  initialShellTabs,
  initialTabs,
  isTabSplit,
  rehydrateTabs,
  selectTab,
  setTabSessionId,
  setTabSplit,
  splitLeafPtyKey,
  tabCwdFor,
  tabPtyKeyFor,
} from "../../tui/workspace/terminal-tabs-core"
import type { HookTabState } from "../../tui/workspace/turn-state-merge"
import type { QuickTaskResult } from "../component/quick-task-composer"
import { bindByIds } from "../context/keybindings"
import { useKV } from "../context/kv"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { useLatest } from "../lib/use-latest"
import { PreviewScreen } from "../ops/preview"
import { useDialog } from "../ui/dialog"
import { TerminalSplit } from "./TerminalSplit"
import { noteEngineTabInput } from "./optimistic-activity"
import { TabStrip } from "./tab-strip"
import { terminalTabsKey } from "./terminal-tabs-persist"
import { reportTabsDelta, setTaskTabs, tabsByTask } from "./terminal-tabs-shared"
import { useTabClose } from "./use-tab-close"
import { useTabDialogs } from "./use-tab-dialogs"
import { useTabHandoffs } from "./use-tab-handoffs"
import { useTabHydration, useTabNaming } from "./use-tab-lifecycle"
import { useTabRequests } from "./use-tab-requests"
import { useTabTurnState } from "./use-tab-turn-state"

export interface TerminalTabsProps {
  taskId: string
  worktree: string
  repo?: string
  taskKind?: "main" | "task" | "dir"
  /** Scratch task: tab-1 is a BARE SHELL, and the last shell exiting deletes
   *  the task via `onScratchExit` instead of recycling into an engine tab. */
  scratch?: boolean
  /** The scratch task's last shell exited — the host deletes the task row. */
  onScratchExit?: () => void
  /** ctrl+e's "scratch shell" choice; the only entry point, no chord. */
  onOpenScratch?: () => void
  command: readonly string[]
  /** Task's engine; builds a per-tab command when a tab pins its own vendor. */
  vendor: VendorId
  modelEffort?: string
  /** Best-effort: persist the picked vendor as the task's new default. */
  onChooseEngine?: (vendor: VendorId) => void
  /** Parent gets an "open this file in the editor tab" function. */
  onEditorTabReady?: (open: (command: readonly string[], label: string) => void) => void
  /** Parent gets a "paste into the active engine tab and submit" function. */
  onEngineSendReady?: (send: (text: string) => boolean) => void
  /** Paste-only sibling of `onEngineSendReady` (no submit) — the FileTree `a` @path mention. */
  onEnginePasteReady?: (paste: (text: string) => boolean) => void
  /** Parent gets an "open read-only diff tab" function (FileTree `d`); a
   *  content swap, not a focus grab. */
  onDiffTabReady?: (open: (relPath: string, label: string, base?: string) => void) => void
  /** Quick-fork submitted: parent creates the child in `repo` (the source's main repo root). */
  onQuickFork?: (repo: string, result: QuickTaskResult) => void
  /** Prompt for the first engine tab, riding its FIRST spawn's argv only. */
  initialPrompt?: string
  /** Daemon per-tab `engine-state`; wins over the quiescence poll. */
  hookTabStates?: ReadonlyMap<string, HookTabState>
  /** Task title — background-toast context line (under the tab label). */
  taskTitle?: string
  /** User landed on a tab; the host resolves Inbox episodes targeting it. */
  onTabVisited?: (tabId: string) => void
  /** Confirmed ESC interrupt; the host reports `turn-interrupted`. */
  onEngineInterrupt?: (tabId: string) => void
  focused: boolean
  /** Ask the host to focus the workspace pane (terminal click). */
  onRequestFocus?: () => void
}

export function TerminalTabs(props: TerminalTabsProps): ReactNode {
  const { theme } = useTheme()
  const dialog = useDialog()
  const notif = useNotifications()
  const kv = useKV()
  const t = useT()
  const persistKey = terminalTabsKey(props.taskId)

  const propsRef = useLatest(props)

  /** Pin a fresh engine-session id on the just-created active engine tab. */
  const pinSession = (s: TabsState, vendor: VendorId | undefined): TabsState => {
    const base = vendor ? engineLaunchArgv({ vendor, effort: props.modelEffort }) : props.command
    const { sessionId } = withPinnedSessionId(base, vendor ?? props.vendor)
    return setTabSessionId(s, s.activeId, sessionId)
  }

  // True when rehydrated from disk: `spawned` flags are up to 5s stale and
  // must be re-verified before anything spawns.
  const rehydratedRef = useRef(false)
  const initState = (): TabsState => {
    const existing = tabsByTask.get(props.taskId)
    if (existing) return existing
    const saved = kv.get(persistKey, null) as TabsState | null
    const fromDisk = saved && Array.isArray(saved.tabs) ? rehydrateTabs(saved, [defaultShell()]) : null
    rehydratedRef.current = fromDisk !== null
    const fresh =
      fromDisk ?? (props.scratch === true ? initialShellTabs(defaultShell()) : pinSession(initialTabs(), undefined))
    tabsByTask.set(props.taskId, fresh) // silent: render phase, see setTaskTabs
    return fresh
  }

  const [state, setState] = useState<TabsState>(initState)
  const stateRef = useLatest(state)

  const update = (next: TabsState): void => {
    reportTabsDelta(propsRef.current.taskId, stateRef.current.tabs, next.tabs)
    setTaskTabs(propsRef.current.taskId, next)
    stateRef.current = next
    setState(next)
    kv.set(persistKey, next)
  }

  const updateRef = useLatest(update)

  /** Focused-leaf emulator cells for split-core's size gate; null → depth-cap fallback. */
  const activeLeafSize = (): { cols: number; rows: number } | null => {
    const s = stateRef.current
    const tab = s.tabs.find((x) => x.id === s.activeId)
    if (!tab) return null
    const leafId = tab.splitTree?.activeLeafId ?? "leaf-1"
    const key = splitLeafPtyKey(tabPtyKeyFor(propsRef.current.taskId, tab), leafId)
    return getDefaultPtyRegistry().get(key)?.size ?? null
  }
  const activeLeafSizeRef = useLatest(activeLeafSize)

  /** Supplies IO reads to the pure `engineTabSpawnFor`. */
  const engineTabSpawn = (tab: EngineTab): TabSpawn => {
    // A tab's pinned command wins over the task's launch argv.
    const base =
      tab.engineCommand || tab.vendor
        ? engineLaunchArgv({ command: tab.engineCommand, vendor: tab.vendor, effort: props.modelEffort })
        : props.command
    const live = getDefaultPtyRegistry().has(tabPtyKeyFor(props.taskId, tab))
    return engineTabSpawnFor(stateRef.current, tab, base, {
      live,
      shell: defaultShell(),
      prompt: propsRef.current.initialPrompt,
      task: {
        id: props.taskId,
        kind: props.taskKind,
        vendor: tab.vendor ?? props.vendor,
        repo: props.repo,
      },
      worktreePath: props.worktree,
    })
  }
  const engineTabSpawnRef = useLatest(engineTabSpawn)

  /** Re-acquire under the visible tab's key (see `resetToken` on `Terminal.tsx`). */
  const [resetToken, setResetToken] = useState(0)

  /* --------- restart resume verification — mount-only ------------------- */
  const hydrating = useTabHydration(rehydratedRef.current, { stateRef, propsRef, update })

  // Once-per-mount parent handoffs. The quick-fork prompt needs no delivery
  // effect: it rides the first spawn.
  const { sendToEngine } = useTabHandoffs({
    stateRef,
    propsRef,
    update,
    engineTabSpawnRef,
    bumpResetToken: () => setResetToken((n) => n + 1),
  })

  // Warm a spare shell so the next tab skips shell startup. Best-effort.
  useEffect(() => {
    warmHostedShell(props.worktree)
  }, [props.worktree])

  const active = state.tabs.find((tab) => tab.id === state.activeId) ?? state.tabs[0]

  /* --------- auto-naming + existence tracking, mount-only --------------- */
  useTabNaming({ stateRef, propsRef, update })

  /* --------- per-tab turn state (hook-first, poll-fallback) --------- */
  const { turnStates, liveTitles, turnVendors, seenTabs } = useTabTurnState({
    taskId: props.taskId,
    worktree: props.worktree,
    vendor: props.vendor,
    state,
    hookTabStates: props.hookTabStates,
    taskTitle: props.taskTitle,
    notif,
    update,
    onEngineInterrupt: props.onEngineInterrupt,
  })

  // Visiting clears the unread mark and reports upstream (visited = handled).
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires only on a real activeId transition; `notif`/`taskId` are stable for this component's lifetime.
  useEffect(() => {
    notif.markRead(props.taskId, state.activeId)
    propsRef.current.onTabVisited?.(state.activeId)
  }, [state.activeId])

  const activeSpawn = (): TabSpawn =>
    active.kind === "command"
      ? {
          command: active.command,
          // A BARE shell tab gets the identity export typed in, so a
          // user-typed engine's hooks report tab-precise events. Editor and
          // one-off command tabs skip it.
          ...(active.purpose !== "editor" && active.command.length === 1 && active.command[0] === defaultShell()
            ? { initialInput: shellIdentityInput(props.taskId, active.id) }
            : {}),
        }
      : active.kind === "content"
        ? // Content tabs have no PTY (a read-only preview); the render below
          // never mounts a Terminal for them, so this spawn is never used.
          { command: [] }
        : engineTabSpawn(active)

  /** Tabs whose dead-on-attach resume was tried: one shot, so a dying
   *  `--resume` closes instead of looping. Here so it survives re-renders. */
  const resumeTriedRef = useRef(new Set<string>())

  // All tab teardown paths share one rule in use-tab-close.ts.
  const tabClose = useTabClose({
    stateRef,
    propsRef,
    updateRef,
    active,
    pinSession,
    bumpResetToken: () => setResetToken((n) => n + 1),
    resumeTriedRef,
    notifyCannotCloseLast: (tabId) =>
      notif.notify({ kind: "error", taskId: props.taskId, tabId, title: t("terminal.tab.cannotCloseLast") }),
    onScratchExit: props.scratch === true ? props.onScratchExit : undefined,
  })
  // The mount-only pending-close listener reads the CURRENT hook via ref.
  const tabCloseRef = useLatest(tabClose)

  const { requestRename, requestNewChat } = useTabDialogs({
    dialog,
    t,
    state,
    active,
    vendor: props.vendor,
    taskId: props.taskId,
    worktree: props.worktree,
    liveTitles,
    update,
    pinSession,
    activeLeafSize,
    onChooseEngine: props.onChooseEngine,
    onQuickFork: props.onQuickFork,
    onOpenScratch: props.onOpenScratch,
    notifyError: (title) => notif.notify({ kind: "error", taskId: props.taskId, tabId: active.id, title }),
  })

  const requestNewChatRef = useLatest(requestNewChat)

  // Cross-component tab requests. Declared AFTER the dialogs hook so the
  // picker opener exists to hand over.
  useTabRequests({
    stateRef,
    propsRef,
    updateRef,
    tabCloseRef,
    activeLeafSizeRef,
    requestNewChatRef,
  })

  /** What ctrl+t runs. Always CONCRETE: an "inherit" mode would let a later
   *  task-vendor switch re-target every earlier tab. */
  const preferredTabVendor = (): VendorId => {
    try {
      return resolvePreferredVendor(resolveMainRepoRoot(props.worktree))
    } catch {
      return props.vendor
    }
  }

  useBindings(() => ({
    enabled: props.focused,
    bindings: bindByIds({
      "chat.tab.new": () => {
        const preferred = preferredTabVendor()
        update(pinSession(addTab(state, preferred), preferred))
      },
      // One dialog: prefix c/f open it with continue/fork pre-flipped.
      "chat.tab.chooseEngine": () => requestNewChat(),
      "chat.tab.fork": prefixAction(() => requestNewChat({ context: "continue" })),
      "chat.tab.cycle-next": () => update(cycleTab(state, 1)),
      "chat.tab.cycle-prev": () => update(cycleTab(state, -1)),
      "chat.tab.goto": (_evt, slot) => update(gotoTab(state, slot ?? 0)),
      "chat.fork.new": prefixAction(() => requestNewChat({ destination: "fork" })),
    }),
  }))

  // ctrl+w / F2 are shared with TerminalSplit's leaf bindings, and ANCESTORS
  // sit on top of the keymap stack (effects run children-first). Gated off
  // while split so the chords reach the leaf.
  const activeIsSplit = isTabSplit(active.splitTree)
  const spawn = activeSpawn()
  useBindings(() => ({
    enabled: props.focused && !activeIsSplit,
    bindings: bindByIds({
      // The HUD's mouse path needs `action`, not just `cmd`.
      "chat.tab.close": prefixAction(() => tabClose.closeActive()),
      "chat.tab.rename": requestRename,
    }),
  }))

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Tab strip — flush to the pane edge, dense; hides itself for a lone
          tab only when the Settings → Terminal toggle asks it to. */}
      <TabStrip
        tabs={state.tabs}
        activeId={state.activeId}
        turnStates={turnStates}
        onSelect={(tabId) => update(selectTab(state, tabId))}
        vendor={props.vendor}
        liveTitles={liveTitles}
        turnVendors={turnVendors}
        seenTabs={seenTabs}
      />
      {/* Spawn gate: while restart verification runs (millisecond-scale
          transcript reads), nothing may spawn. */}
      {hydrating ? (
        <box flexGrow={1} paddingLeft={1} paddingTop={1}>
          <text fg={theme.textMuted}>{t("terminal.restoring")}</text>
        </box>
      ) : active.kind === "content" ? (
        // No PTY; `onClose` closes THIS tab rather than exiting.
        <PreviewScreen
          worktree={props.worktree}
          relPath={active.relPath}
          base={active.base}
          focused={props.focused}
          onClose={() => tabClose.closeExited(active.id)}
          // Per-task, kv-persisted notes, sent over the PTY paste path.
          review={buildDiffReview(kv, props.taskId, sendToEngine)}
        />
      ) : (
        <TerminalSplit
          tabKey={tabPtyKeyFor(props.taskId, active)}
          cwd={tabCwdFor(active, props.worktree)}
          command={spawn.command}
          initialInput={spawn.initialInput}
          firstMessage={spawn.firstMessage}
          engineBin={spawn.engineBin}
          terminalPresentation={
            active.kind === "engine" ? getCapabilities(active.vendor ?? props.vendor)?.terminalPresentation : undefined
          }
          onUserInput={
            active.kind === "engine"
              ? (data) => noteEngineTabInput(data, props.taskId, active.id, props.hookTabStates?.get(active.id)?.state)
              : undefined
          }
          splitTree={active.splitTree ?? null}
          onSplitChange={(next) => update(setTabSplit(state, active.id, next))}
          onExit={tabClose.handleActiveExit}
          resetToken={resetToken}
          focused={props.focused}
          onRequestFocus={props.onRequestFocus}
          // Not the "group N" fallback.
          engineTitle={active.title ?? active.autoTitle ?? null}
        />
      )}
    </box>
  )
}
