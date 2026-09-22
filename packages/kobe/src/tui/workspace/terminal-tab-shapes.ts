/**
 * What a tab IS ({@link TerminalTab}); `terminal-tabs-core.ts` owns what
 * happens to the list and re-exports these. Kept apart so the split tree, argv
 * composition and components get the shapes without tab-list logic.
 * Types only, so the core↔shapes pair erases at build time and can't cycle.
 */

import type { VendorId } from "@/types/vendor"
import type { PersistedSplit } from "./terminal-tab-split"

interface TabBase {
  /** Stable id — registry key suffix. Never reused within a task. */
  readonly id: string
  /** User title; null = untitled (view shows the numbered default). */
  readonly title: string | null
  /** 1-based creation ordinal — drives the "Tab {n}" default title. */
  readonly ordinal: number
  /**
   * From the tab's own session's first prompt (`runChatTabNamingPass`). A
   * manual F2 `title` always wins; clearing it falls back here.
   */
  readonly autoTitle?: string | null
  /**
   * Last live OSC title, recorded so surfaces not hosting the tab (the Inbox)
   * show current activity instead of the frozen first-prompt `autoTitle`.
   * Precedence: `title ?? liveName ?? lastTitle ?? autoTitle ?? default`.
   */
  readonly lastTitle?: string | null
  /**
   * Engine identity from the process-tree probe. Hosted PTYs outlive a TUI
   * restart but the fresh registry only knows attached PTYs, so without this a
   * shell running `claude` loses its agent status in the sidebar. Written only
   * for tabs with a live title (attached, so a missing vendor is
   * authoritative); an unattached tab keeps its last value.
   */
  readonly liveVendor?: VendorId | null
  /**
   * Persisted split layout; absent/null = unsplit. `leaf-1` is the tab's
   * engine and resumes via `sessionId`; other leaves respawn as fresh shells
   * (layout only — a `claude` run inside one comes back as a shell). Owned by
   * `TerminalSplit`, mutated through `setTabSplit`.
   */
  readonly splitTree?: PersistedSplit | null
}

/**
 * Engine CLI typed into `$SHELL` as initial input ({@link shellSpawn}), so
 * exiting the vendor lands on a shell prompt with full rc context. Closes only
 * when that shell exits.
 */
export interface EngineTab extends TabBase {
  readonly kind: "engine"
  /** Per-tab protocol override (`chat.tab.chooseEngine`, or resolved from {@link command}); undefined = the task's engine. */
  readonly vendor?: VendorId
  /**
   * Raw launch command (`send --tab new --command …`); wins over {@link vendor}
   * at spawn, `vendor` then holds the resolved protocol. Not `command`:
   * {@link CommandTab} owns that name, and sharing it breaks discrimination.
   */
  readonly engineCommand?: string
  /**
   * Session id pinned at spawn (`withClaudeSessionId`), so the tab is named
   * from its own first prompt and can resume. Null for vendors that can't take
   * a caller-set id (codex/custom — named from the worktree instead).
   */
  readonly sessionId?: string | null
  /** Set once the PTY spawned; after a restart the tab resumes (`--resume <sessionId>`) instead of opening blank under the same id. */
  readonly spawned?: boolean
  /**
   * Session this tab forked from: the first spawn opens on its history and
   * branches into this tab's own session, so two processes never share one
   * transcript. First spawn only (`engineTabArgv`).
   */
  readonly forkFrom?: string | null
  /**
   * Typed on first spawn only — the handoff brief (`session-handoff.ts`). The
   * task-level `initialPrompt` only reaches a task's first engine tab, so a
   * later handoff tab carries its own.
   */
  readonly initialPrompt?: string | null
  /**
   * Viewport onto another task's first engine session (kanban project chattab
   * with its own worktree): attaches `<ptyTask.id>::tab-1`, cwd = that
   * worktree, activity attributed to that task. Workspaces render one at a
   * time, so both views never attach at once.
   */
  readonly ptyTask?: { readonly id: string; readonly worktree: string }
}

/** Fixed argv (`openEditorTab`, the ctrl+e shell pick); closes and releases its PTY when the process exits. */
export interface CommandTab extends TabBase {
  readonly kind: "command"
  readonly command: readonly string[]
  /** FileTree-owned singleton slot. Other command tabs remain independent. */
  readonly purpose?: "editor"
}

/**
 * Read-only preview (FileTree `d`) from a one-shot git read (`loadPreviewData`)
 * — no PTY. A singleton slot: {@link openContentTab} replaces it in place.
 */
export interface ContentTab extends TabBase {
  readonly kind: "content"
  /** Worktree-relative path being previewed. */
  readonly relPath: string
  /** Base ref for the vs-base (Branch scope) diff; absent = diff vs HEAD. */
  readonly base?: string
}

/** Discriminated on `kind` so vendor+command on one tab, or close-on-exit without a command, can't be represented. */
export type TerminalTab = EngineTab | CommandTab | ContentTab

/** A task's persisted tab list; produced by `terminal-tabs-lifecycle.ts` and `terminal-tabs-core.ts`. */
export interface TabsState {
  readonly tabs: readonly TerminalTab[]
  readonly activeId: string
  /** Next ordinal to hand out (monotonic — close does not recycle). */
  readonly nextOrdinal: number
  /**
   * Kind of the last tab closed, so re-entering an emptied task reopens the
   * same kind ({@link reopenTabs}). Set only while `tabs` is empty. Absent
   * means "default", not an error — older snapshots lack it.
   */
  readonly reopenAs?: { readonly kind: "engine"; readonly vendor?: VendorId } | { readonly kind: "command" }
}
