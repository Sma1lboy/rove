/** Workspace keybinding rows, split out to keep the keymap table small. */

import type { KobeBinding } from "./keybindings-table.ts"

export const CHAT_BINDINGS: readonly KobeBinding[] = [
  // ─── Workspace ────────────────────────────────────────────────────────
  // No composer rows (`chat.send` / newline / cycle-mode / steer / interrupt):
  // the workspace is the engine CLI in a PTY, and one vendor's composer keys
  // don't belong in Rove's help (`shift+enter` can't even be delivered without
  // the kitty protocol Rove keeps off). Engine UI data is the adapter's (AGENTS.md).
  {
    id: "chat.tab.new",
    scope: "workspace",
    // Direct-only: tab management is high-frequency.
    keys: ["ctrl+t"],
    category: "Workspace",
    description: "New chat tab",
    hint: { keys: "ctrl+t" },
    presentation: "onePress",
  },
  {
    // `ctrl+e` = "engine", the new-task dialog's vendor-cycle mnemonic. Not
    // `ctrl+shift+t`: shift+ is dropped on letters, so it equals ctrl+t.
    // Opens the UNIFIED new-conversation dialog: enter = new tab on this
    // engine; in-dialog `tab` flips destination (tab ⇄ fork a child task),
    // `ctrl+f` flips context (fresh ⇄ continue). See
    // docs/design/keybinding-decisions.md.
    id: "chat.tab.chooseEngine",
    scope: "workspace",
    keys: ["ctrl+e"],
    category: "Workspace",
    description: "New conversation — engine/shell picker with destination + context toggles",
    hint: { keys: "ctrl+e" },
    presentation: "onePress",
  },
  {
    // Forks the CONVERSATION into a new tab in the SAME worktree (claude
    // `--resume … --fork-session`, `codex fork`); `chat.fork.new` forks the
    // WORKTREE. A preset of `chat.tab.chooseEngine` with context = "continue".
    id: "chat.tab.fork",
    scope: "workspace",
    keys: [],
    prefixKeys: ["c"],
    category: "Workspace",
    description: "Fork this chat into a new tab (same Task directory, keeps the conversation)",
    hint: { keys: "ctrl+a c" },
  },
  {
    // Child task inheriting repo + branch + model; the dialog asks only for a
    // prompt and the first turn fires immediately. A preset of
    // `chat.tab.chooseEngine` with destination = "fork a child task"; enter
    // continues into QuickTaskComposer.
    id: "chat.fork.new",
    scope: "workspace",
    keys: [],
    prefixKeys: ["f"],
    category: "Workspace",
    description: "Quick-fork: create child task seeded with current repo/branch/model",
    hint: { keys: "ctrl+a f" },
  },
  {
    id: "chat.tab.close",
    scope: "workspace",
    // Mutually gated with workspace.split.close, so whichever is live owns
    // BOTH strokes; without prefix-w here, `<prefix> w` on an unsplit tab was
    // swallowed despite the docs promising it closes the tab.
    keys: ["ctrl+w"],
    prefixKeys: ["w"],
    category: "Workspace",
    description: "Close chat tab",
    hint: { keys: "ctrl+w" },
    presentation: "onePress",
  },
  {
    // Covers ctrl+w on a task's LAST tab: `EmptyWorkspacePane` has no
    // TerminalTabs, so every other workspace chord is unreachable there. Plain
    // `return` is safe because that pane holds no input and the binding is
    // gated on it being on screen. See docs/design/keybinding-decisions.md.
    id: "workspace.reopenSession",
    scope: "workspace",
    keys: ["return"],
    category: "Workspace",
    description: "Reopen a session in a task whose tabs are all closed",
    hint: { keys: "enter" },
    presentation: "onePress",
  },
  {
    // F2 is the cross-OS/IDE rename convention; `ctrl+r` is the engine's
    // prompt-history search.
    id: "chat.tab.rename",
    scope: "workspace",
    keys: ["f2"],
    category: "Workspace",
    description: "Rename active chat tab",
    hint: { keys: "f2" },
    presentation: "onePress",
  },
  {
    // `ctrl+]` / `ctrl+[` mirror the `[/]` cyclers in sidebar and files.
    // `ctrl+tab` stays unbound: collision-prone.
    id: "chat.tab.cycle-next",
    scope: "workspace",
    // Direct-only: a two-stroke prefix per hop is unusable.
    keys: ["ctrl+]"],
    category: "Workspace",
    description: "Next chat tab",
    hint: { keys: "ctrl+]" },
    presentation: "onePress",
  },
  {
    id: "chat.tab.cycle-prev",
    scope: "workspace",
    keys: ["ctrl+["],
    category: "Workspace",
    description: "Previous chat tab",
    hint: { keys: "ctrl+[" },
    presentation: "onePress",
  },
  {
    // CONTENT-NEUTRAL ids: the split tree (`workspace/split-core.ts`) is
    // generic over leaf content. `ctrl+\` reads as a vertical divider → leaf
    // RIGHT; `ctrl+=` as horizontal strokes → leaf BELOW. Both need the kitty
    // protocol (legacy can't encode ctrl+=; ctrl+\ is SIGQUIT), see
    // docs/KEYBINDINGS.md. Direct-only.
    id: "workspace.split.right",
    scope: "workspace",
    keys: ["ctrl+\\"],
    category: "Workspace",
    description: "Split right",
    hint: { keys: "ctrl+\\" },
    presentation: "onePress",
  },
  {
    id: "workspace.split.down",
    scope: "workspace",
    keys: ["ctrl+="],
    category: "Workspace",
    description: "Split down",
    hint: { keys: "ctrl+=" },
    presentation: "onePress",
  },
  {
    // F3: every useful ctrl+letter is engine passthrough or taken, and F-keys
    // already carry tab vocabulary (F2).
    id: "workspace.split.focus-next",
    scope: "workspace",
    keys: ["f3"],
    category: "Workspace",
    description: "Focus next split",
    hint: { keys: "f3" },
    presentation: "onePress",
  },
  {
    // While SPLIT, ctrl+w / prefix-w close the active leaf (VS Code/iTerm/Warp).
    // Mutual gating (React stacks ancestors on top, see tui-react/lib/keymap.ts):
    // TerminalSplit enables this only when split and TerminalTabs disables its
    // close-tab entry then, so exactly one is live and owns BOTH strokes.
    id: "workspace.split.close",
    scope: "workspace",
    keys: ["ctrl+w"],
    prefixKeys: ["w"],
    category: "Workspace",
    description: "Close active split (tab when unsplit)",
    hint: { keys: "ctrl+w" },
    presentation: "onePress",
  },
  {
    // While SPLIT, F2 renames the ACTIVE LEAF (overrides the default basename
    // of what it runs); unsplit falls through the LIFO stack to rename-tab.
    id: "workspace.split.rename",
    scope: "workspace",
    keys: ["f2"],
    category: "Workspace",
    description: "Rename active split (tab when unsplit)",
    hint: { keys: "f2" },
    presentation: "onePress",
  },
  // No AskUserQuestion picker rows: the engine CLI owns its own question UI.
]
