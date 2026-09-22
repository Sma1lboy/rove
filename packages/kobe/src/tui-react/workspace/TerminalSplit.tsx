/** @jsxImportSource @opentui/react */
/**
 * One workspace terminal tab's body: a TERMINAL adapter over the split tree
 * (`tui/workspace/split-core.ts`). Leaf content null = the tab's own command
 * (only `leaf-1`, whose PTY key IS the tab key); an argv = a split shell.
 *
 * A leaf whose process exits removes itself tmux-style; the LAST leaf's exit
 * fires the tab-level `onExit` (the caller owns degrade/close). Split state
 * lives ON the tab (`TerminalTab.splitTree`, persisted), mutated back through
 * `onSplitChange`.
 */

import type { EngineTerminalPresentation } from "@/types/terminal-presentation"
import { type RGBA, TextAttributes } from "@opentui/core"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { SPLIT_STYLE_KEY, normalizeSplitStyle } from "../../state/split-style"
import { prefixAction } from "../../tui/lib/keymap-dispatch"
import { defaultShell } from "../../tui/panes/terminal/pty-types"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import {
  type SplitLeaf,
  type SplitNode,
  type SplitState,
  cycleLeaf,
  initialSplit,
  leaves,
  removeLeaf,
  renameLeaf,
  splitActive,
} from "../../tui/workspace/split-core"
import {
  type PersistedSplit,
  collapseSplit,
  isTabSplit,
  splitLeafNames,
  splitLeafPtyKey,
} from "../../tui/workspace/terminal-tabs-core"
import { RenameTaskDialog } from "../component/rename-task-dialog"
import { bindByIds } from "../context/keybindings"
import { useKV } from "../context/kv"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { Terminal } from "../panes/terminal/Terminal"
import { useDialog } from "../ui/dialog"
import { FRAME } from "../ui/frame"
import { useTitleSubscriptions } from "./title-subscriptions"

/** What a terminal leaf shows: null = the tab's own command (`leaf-1`). */
type LeafCommand = readonly string[] | null

/** Stable single-leaf tree, so a `null` splitTree mints no object per read. */
const UNSPLIT: PersistedSplit = initialSplit(null)

/** Release every split-created leaf PTY of `tabKey` on tab close (`leaf-1` is
 *  released by TerminalTabs). Null/unsplit trees release nothing. */
export function releaseSplitLeaves(tabKey: string, tree: PersistedSplit | null): void {
  if (!tree) return
  for (const leaf of leaves(tree.root)) {
    if (leaf.id !== "leaf-1") getDefaultPtyRegistry().release(splitLeafPtyKey(tabKey, leaf.id))
  }
}

export function TerminalSplit(props: {
  /** `tabPtyKey(taskId, tabId)` — PTY registry prefix for this tab's leaves. */
  tabKey: string
  cwd: string
  /** What the tab's ORIGINAL leaf (`leaf-1`) runs — engine or command. */
  command: readonly string[]
  /** Typed into leaf-1's FRESH spawn (`TaskPtyOpts.initialInput`); never split leaves. */
  initialInput?: string
  /** leaf-1's fresh-spawn first message (`TaskPtyOpts.firstMessage`); never split leaves. */
  firstMessage?: string
  /** Engine binary name for the first-message engine-up probe. */
  engineBin?: string
  /** The active tab's split layout (null = unsplit); parent-owned and persisted. */
  splitTree: PersistedSplit | null
  /** Persist a changed layout (null clears back to the unsplit fast path). */
  onSplitChange: (next: PersistedSplit | null) => void
  /** Fires only when the LAST leaf exits. `info.deadOnAttach` only from the
   *  unsplit fast path; a split tab's last exit is always live. */
  onExit?: (info?: { deadOnAttach?: boolean }) => void
  /** Forwarded to `leaf-1`'s Terminal — the shell-degrade reacquire nudge. */
  resetToken?: number
  focused: boolean
  /** Ask the host to focus the workspace pane (terminal click). */
  onRequestFocus?: () => void
  /** Raw input feed, ORIGINAL (engine) leaf only: shell keys aren't turn triggers. */
  onUserInput?: (data: string) => void
  /** The engine leaf's name (title ?? autoTitle); null before the first prompt. */
  engineTitle?: string | null
  /** Vendor presentation applies to leaf-1 only; split-created shells stay native. */
  terminalPresentation?: EngineTerminalPresentation
}): ReactNode {
  const { theme, transparentBackground } = useTheme()
  const inactiveBorder = transparentBackground ? theme.border : theme.borderSubtle
  const t = useT()
  const kv = useKV()
  const state = props.splitTree ?? UNSPLIT

  // Focus is local, OUT of the persisted tree, so moving it never reflows the
  // tree. Re-seeded from `activeLeafId` when the tree changes identity.
  const [activeLeaf, setActiveLeaf] = useState<string>(state.activeLeafId)
  useEffect(() => {
    setActiveLeaf((props.splitTree ?? UNSPLIT).activeLeafId)
  }, [props.splitTree])

  /** Full SplitState for the structural transitions that read the active
   *  leaf (split / remove / cycle operate relative to it). */
  const fullState = (): PersistedSplit => ({ ...state, activeLeafId: activeLeaf })

  // STRUCTURAL changes only; `collapseSplit` folds a sole leaf-1 back to null.
  const update = (next: SplitState<LeafCommand>): void => {
    if (next === state) return
    props.onSplitChange(collapseSplit(next))
  }

  const isSplit = isTabSplit(state)
  // `box` frames every leaf, `line` draws dividers; only while ACTUALLY split,
  // or a lone leaf double-frames inside the bordered column.
  const useBoxFrames = normalizeSplitStyle(kv.get(SPLIT_STYLE_KEY)) === "box" && isSplit
  // Only a pristine leaf-1 (what `collapseSplit` folds to null) takes the fast path.
  const renderViaTree = collapseSplit(state) !== null

  /** Remove `id` and kill its PTY; false for the last leaf. State first (the
   *  re-render detaches subscribers), then release. */
  function removeAndRelease(id: string): boolean {
    const cur = fullState()
    const next = removeLeaf(cur, id)
    if (next === null) return false
    if (next !== cur) {
      update(next)
      getDefaultPtyRegistry().release(splitLeafPtyKey(props.tabKey, id))
    }
    return true
  }

  function onLeafExit(id: string): void {
    if (removeAndRelease(id)) return
    // Last leaf: release any dead non-leaf-1 entry, clear the layout, hand off the exit.
    releaseSplitLeaves(props.tabKey, state)
    props.onSplitChange(null)
    props.onExit?.()
  }

  /** Focused leaf's cells for split-core's ≥ MIN_PANE_* gate; null (unspawned) → depth cap. */
  const activeLeafSize = (): { cols: number; rows: number } | null =>
    getDefaultPtyRegistry().get(splitLeafPtyKey(props.tabKey, activeLeaf))?.size ?? null

  useBindings(() => ({
    enabled: props.focused,
    bindings: bindByIds({
      "workspace.split.right": () => update(splitActive(fullState(), "row", [defaultShell()], activeLeafSize())),
      "workspace.split.down": () => update(splitActive(fullState(), "column", [defaultShell()], activeLeafSize())),
      "workspace.split.focus-next": () => setActiveLeaf(cycleLeaf(fullState(), 1).activeLeafId),
    }),
  }))

  // While split, ctrl+w / F2 act on the ACTIVE LEAF (as VS Code/iTerm/tmux);
  // unsplit, they fall through to TerminalTabs' tab bindings.
  const dialog = useDialog()
  useBindings(() => ({
    enabled: props.focused && isSplit,
    bindings: bindByIds({
      "workspace.split.close": prefixAction(() => removeAndRelease(activeLeaf)),
      "workspace.split.rename": () => {
        const id = activeLeaf
        void RenameTaskDialog.show(dialog, leafNames.get(id) ?? "", {
          dialogTitle: t("terminal.split.renameTitle"),
          fieldLabel: t("terminal.split.renameField"),
          submitLabel: t("terminal.tab.renameSubmit"),
          allowEmpty: true,
        }).then((title) => {
          if (title === undefined) return
          update(renameLeaf(fullState(), id, title))
        })
      },
    }),
  }))

  const leafFocused = (id: string) => props.focused && activeLeaf === id

  // Live OSC titles for EVERY leaf, leaf-1 included (a shell tab can enter
  // vim). Subscribed by the globally-unique `splitLeafPtyKey`: leaf ids are
  // per-tab, and this instance mounts without a key across tabs.
  const leafPtyKeys = useMemo(() => {
    const map = new Map<string, string>()
    for (const leaf of leaves(state.root)) map.set(leaf.id, splitLeafPtyKey(props.tabKey, leaf.id))
    return map
  }, [props.tabKey, state])
  const liveTitles = useTitleSubscriptions(leafPtyKeys)

  /** id → display name: F2 rename wins, else basename of what it runs ("zsh 2"). */
  const leafNames = splitLeafNames(leaves(state.root), props.command, props.engineTitle, liveTitles)

  /* Dividers, not frames: a node draws ONLY the single edge it shares with
   * its previous sibling (`left` in a row, `top` in a column) — tmux's
   * separator-line look, zero padding, no outer wrapping. The divider a
   * focused LEAF owns lights up in the focus accent. */

  // `borderColor` must be ABSENT (not undefined) on divider-less boxes:
  // opentui coerces `border: false` to a full frame whenever any border
  // styling lands, and the setter fires even for undefined. Hence the spread.
  const dividerProps = (divider: "left" | "top" | undefined, color: RGBA) =>
    divider ? { border: [divider] as ("left" | "top")[], borderColor: color } : { border: false as const }

  const renderLeaf = (leaf: SplitLeaf<LeafCommand>, divider?: "left" | "top"): ReactNode => {
    const focusThis = (): void => setActiveLeaf(leaf.id)
    const imeAnchorActive = activeLeaf === leaf.id
    const focused = leafFocused(leaf.id)
    const body = (
      <>
        <Terminal
          cwd={props.cwd}
          taskId={splitLeafPtyKey(props.tabKey, leaf.id)}
          command={leaf.content ?? props.command}
          initialInput={leaf.content === null ? props.initialInput : undefined}
          firstMessage={leaf.content === null ? props.firstMessage : undefined}
          engineBin={leaf.content === null ? props.engineBin : undefined}
          terminalPresentation={leaf.content === null ? props.terminalPresentation : undefined}
          onUserInput={leaf.content === null ? props.onUserInput : undefined}
          onExit={() => onLeafExit(leaf.id)}
          resetToken={leaf.id === "leaf-1" ? props.resetToken : undefined}
          focused={focused}
          imeAnchorActive={imeAnchorActive}
          onRequestFocus={() => {
            props.onRequestFocus?.()
            focusThis()
          }}
        />
        {/* Corner name tag — ONLY while there's more than one leaf to tell
            apart: a solo survivor already shows this name on the tab
            strip. */}
        {isSplit ? (
          <box position="absolute" right={0} top={0} zIndex={10} backgroundColor={theme.backgroundElement}>
            <text
              fg={focused ? theme.focusAccent : theme.textMuted}
              attributes={focused ? TextAttributes.BOLD : TextAttributes.DIM}
              wrapMode="none"
            >
              {` ${leafNames.get(leaf.id) ?? ""} `}
            </text>
          </box>
        ) : null}
      </>
    )
    if (useBoxFrames) {
      // Box style: every leaf is its own frame; no shared-edge dividers.
      return (
        <box
          key={leaf.id}
          flexGrow={1}
          flexShrink={1}
          flexBasis={0}
          {...FRAME}
          borderColor={focused ? theme.focusAccent : inactiveBorder}
          onMouseUp={focusThis}
        >
          {body}
        </box>
      )
    }
    return divider ? (
      <box
        key={leaf.id}
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        border={[divider]}
        borderColor={focused ? theme.focusAccent : inactiveBorder}
        onMouseUp={focusThis}
      >
        {body}
      </box>
    ) : (
      <box key={leaf.id} flexGrow={1} flexShrink={1} flexBasis={0} border={false} onMouseUp={focusThis}>
        {body}
      </box>
    )
  }

  // Key AT THE PARENT: leaves by id, nested groups by sibling INDEX (stable:
  // split-core returns whole new trees, never reorders in place).
  const renderNode = (node: SplitNode<LeafCommand>, groupKey: string, divider?: "left" | "top"): ReactNode =>
    node.kind === "leaf" ? (
      renderLeaf(node, divider)
    ) : (
      <box
        key={groupKey}
        flexDirection={node.orientation}
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        {...dividerProps(useBoxFrames ? undefined : divider, inactiveBorder)}
      >
        {node.children.map((child, i) =>
          renderNode(
            child,
            child.kind === "leaf" ? child.id : `${groupKey}.${i}`,
            i > 0 ? (node.orientation === "row" ? "left" : "top") : undefined,
          ),
        )}
      </box>
    )

  if (renderViaTree) {
    return (
      <box flexDirection="column" flexGrow={1} overflow="hidden">
        {renderNode(state.root, "root")}
      </box>
    )
  }
  // Unsplit fast path: one Terminal, props swapped on tab switch, never remounted.
  return (
    <Terminal
      cwd={props.cwd}
      taskId={props.tabKey}
      command={props.command}
      initialInput={props.initialInput}
      firstMessage={props.firstMessage}
      engineBin={props.engineBin}
      terminalPresentation={props.terminalPresentation}
      onUserInput={props.onUserInput}
      onExit={props.onExit}
      resetToken={props.resetToken}
      focused={props.focused}
      imeAnchorActive={true}
      onRequestFocus={props.onRequestFocus}
    />
  )
}
