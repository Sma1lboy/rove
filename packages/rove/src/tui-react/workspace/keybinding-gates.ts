/**
 * Pure gating predicates for host-keybindings.ts, framework-free so vitest can
 * pin "an open dialog/page disables workspace chords" without `@opentui/react`.
 *
 * The ModalBarrier (ui/dialog.tsx) already blocks keys under a dialog;
 * `dialogOpen` is defense in depth there and the ONLY gate for the full-page
 * swaps (settings/worktrees/update), which mount no barrier.
 */

export type WorkspacePageState = {
  /** `dialog.stack.length > 0` — any dialog up on the shared stack. */
  dialogOpen: boolean
  settingsOpen: boolean
  worktreesOpen: boolean
  updateOpen: boolean
  /**
   * Rail pages, NOT part of {@link workspacePagesClosed}: they replace only the
   * content pane, so sidebar chords (including the prefix, to switch rail pages
   * without esc) stay live.
   */
  kanbanOpen: boolean
  automationsOpen: boolean
  workItemsOpen: boolean
}

/**
 * Gate for every workspace-level chord group; the one exemption is
 * {@link settingsCloseKeysEnabled}.
 */
export function workspacePagesClosed(s: WorkspacePageState): boolean {
  // Only full-window surfaces gate: they cover the sidebar, so a sidebar chord
  // would act on something unseen.
  return !s.dialogOpen && !s.settingsOpen && !s.worktreesOpen && !s.updateOpen
}

/**
 * Settings' own close keys (esc/q/ctrl+c): live because settings is open, but
 * yield to a sub-dialog above it (the engine-command editor needs esc + typing).
 */
export function settingsCloseKeysEnabled(s: WorkspacePageState): boolean {
  return s.settingsOpen && !s.dialogOpen
}

/** Focus cycle order: sidebar ← workspace → files. */
const PANE_CYCLE = ["sidebar", "workspace", "files"] as const
export type CyclePaneId = (typeof PANE_CYCLE)[number]

/**
 * Next focused pane. Files drops out of the cycle when unmounted (zen, any rail
 * page) — focusing it would strand the cursor. Clamps at both ends, no wrap, so
 * "previous" from the sidebar never jumps to files. Null = don't move.
 */
export function nextFocusedPane(current: string, delta: 1 | -1, opts: { filesVisible: boolean }): CyclePaneId | null {
  const reachable = PANE_CYCLE.filter((pane) => pane !== "files" || opts.filesVisible)
  const idx = reachable.indexOf(current as CyclePaneId)
  // Focused pane just vanished — step to the nearest end.
  if (idx < 0) return (delta > 0 ? reachable[reachable.length - 1] : reachable[0]) ?? null
  const next = Math.min(Math.max(idx + delta, 0), reachable.length - 1)
  return next === idx ? null : ((reachable[next] as CyclePaneId) ?? null)
}
