/**
 * Pure state-machine helpers for the new-task dialog (field cycling, repo
 * lists, filtering, picker windowing), unit-testable without the dialog stack.
 * **Keep this file framework-free AND side-effect-free**; fs/subprocess work
 * lives elsewhere:
 *
 *   - sync git snapshots (branch, branch list, repo validation) →
 *     `src/tui/lib/git-snapshot.ts` (its sync-guard whitelist entry lives there).
 *   - path/dir suggestion plumbing → `src/tui/lib/path-helpers.ts`.
 *   - clone-tab fs/spawn helpers → `./clone.ts`.
 *
 * Wired to component state by `src/tui-react/component/new-task-dialog/`.
 */

import { matchPathGlob } from "@/lib/path-glob"
import type { VendorId } from "@/types/vendor"
import type { AdoptableWorktree } from "@/types/worktree"
import { pathIdentity, pathSyntax, samePath } from "@sma1lboy/kobe-daemon/path-identity"
import { DEFAULT_BASE_REF } from "../../lib/git-snapshot"

/* --------------------------------------------------------------------- */
/*  Public types                                                          */
/* --------------------------------------------------------------------- */

/**
 * Dialog result, discriminated by `mode`:
 *   - create (default) — fresh task on `repo` at `baseRef`.
 *   - adopt — import existing worktrees; the caller loops
 *     `orchestrator.adoptWorktree` over `adopt`.
 *   - open — open `repo`'s own checkout (its `main` row). The only way back to
 *     a hidden project (`isClosedDownProject`): every other path mints a
 *     `kind: "task"`, leaving an extra worktree and still no project row.
 */
export type NewTaskInput =
  | {
      mode?: "create"
      repo: string
      baseRef: string
      /** Engine the task runs on. Defaults to the user's last-selected vendor. */
      vendor: VendorId
      /** Reasoning level, when the engine declares levels and one was picked. */
      modelEffort?: string
      /** Pinned model, when the engine declares a model flag and one was typed. */
      model?: string
      /** The auto-effort tier the three fields above were filled from, when one was. */
      tier?: string
      /**
       * Set when submitted from the New Repo tab: the clone already finished and
       * `repo` is its path. Caller persists `lastClonedRepoParent` and saves `repo`.
       */
      cloned?: { parentDir: string }
    }
  | {
      mode: "adopt"
      repo: string
      vendor: VendorId
      adopt: readonly { worktreePath: string; branch: string }[]
    }
  | {
      mode: "open"
      repo: string
      vendor: VendorId
    }

/**
 * Options for opening the dialog. Framework-free so `lib/task-actions.ts` can
 * type its `promptNewTask` adapter without a JSX import.
 */
export type NewTaskDialogOptions = {
  /** Default parent dir for the Clone tab (kv `lastClonedRepoParent`); falls back to `~/`. */
  defaultCloneParent?: string
  /** Engine to pre-select (kv `lastSelectedVendor`); falls back to claude. */
  defaultVendor?: VendorId
  /** Vendors detected on this machine; the selector lists only these. Omit/empty → all vendors. */
  availableVendors?: readonly VendorId[]
  /** Adopt-tab discovery of unlinked worktrees on `repo`; omit to disable adoption. */
  discoverAdoptable?: (repo: string) => Promise<readonly AdoptableWorktree[]>
  /**
   * Repos with a project checkout (a `main` task), trailing slashes trimmed.
   * Only these get "open the project" ({@link offersProjectIntent}); empty =
   * the choice never appears.
   */
  mainRepos?: ReadonlySet<string>
}

/** Active sub-tab; Ctrl+[ / Ctrl+] switch it while the dialog is open. */
export type DialogTab = "existing" | "clone" | "adopt"

/** Cycle helper for the tab strip: existing → clone → adopt → existing. */
export function nextDialogTab(tab: DialogTab): DialogTab {
  if (tab === "existing") return "clone"
  if (tab === "clone") return "adopt"
  return "existing"
}

/** Reverse cycle for the tab strip: existing → adopt → clone → existing.
 *  Powers ←/→ navigation when the mode-tab selector is focused. */
export function prevDialogTab(tab: DialogTab): DialogTab {
  if (tab === "existing") return "adopt"
  if (tab === "clone") return "existing"
  return "clone"
}

/**
 * Focusable fields. Shared, top of the visual order:
 *   - `tabs`   — mode-tab selector; ←/→ switches sub-tab.
 *   - `tier`   — auto-effort chips; only while auto effort is configured.
 *   - `engine` — vendor selector; ←/→ (or ctrl+e anywhere) cycles it.
 *   - `effort` — reasoning chips; only for engines that declare levels.
 *   - `model`  — model input; only for engines with a model flag.
 * Per sub-tab: existing `repo`/`baseRef`; clone `cloneUrl`/`cloneParent`/
 * `cloneFolder`/`cloneBaseRef`; adopt `adoptFilter`. `confirm` is the shared
 * Create button. Tab walks the whole chain.
 */
export type Field =
  | "tabs"
  | "tier"
  | "engine"
  | "effort"
  | "model"
  | "repo"
  /** The Existing tab's task-vs-project selector. Reachable only
   *  while it renders — see `nextField`. */
  | "intent"
  | "baseRef"
  | "cloneUrl"
  | "cloneParent"
  | "cloneFolder"
  | "cloneBaseRef"
  | "adoptFilter"
  | "confirm"

/**
 * List under the repo input:
 *   - "saved" — substring filter over saved repos (cwd + /add-repo). Default.
 *   - "browse" — directory drill-down, when the input is path-shaped AND not an
 *     exact saved match (so the cwd default doesn't open as a parent browse).
 */
export type PickerMode = "saved" | "browse"

/** `repoOptions` is the deduped saved list; an exact match short-circuits to "saved". */
export function pickerModeFor(value: string, repoOptions: readonly string[]): PickerMode {
  const trimmed = value.trim()
  if (repoOptions.includes(trimmed)) return "saved"
  const trailingSeparator = trimmed.endsWith("/") || (pathSyntax(trimmed).sep === "\\" && trimmed.endsWith("\\"))
  if (!trailingSeparator && repoOptions.some((repo) => samePath(repo, trimmed))) return "saved"
  if (isRepoPathInput(trimmed)) return "browse"
  return "saved"
}

export function isRepoPathInput(value: string): boolean {
  return (
    value.startsWith("~") ||
    value.includes("/") ||
    pathSyntax(value).sep === "\\" ||
    (process.platform === "win32" && value.includes("\\"))
  )
}

/** Picker windowing cap on a terminal with room. Matches the slash
 *  dropdown's `slashWindow`. */
export const PICKER_MAX_VISIBLE = 8

/**
 * Terminal rows the dialog needs besides the open picker, counted off the
 * Existing tab (the tallest): title, mode row, engine label + choices, field
 * labels + inputs, picker overflow lines, action row, card padding, plus
 * `Dialog`'s outer margin — the budget is the TERMINAL's height.
 */
const PICKER_CHROME_ROWS = 22
/** The floor. Two rows plus the `↓ N more` line still reads as a list and
 *  still scrolls under the cursor, so nothing becomes unreachable; going
 *  lower would leave the cursor with nowhere to sit. */
const PICKER_MIN_VISIBLE = 2

/**
 * Visible picker rows for a viewport `height`. A flat cap overran
 * `maxCardHeight` on a 24-row terminal and clipped the Create button and
 * `submitError`, so a failed create looked like nothing happened. The list
 * scrolls under the cursor, so shrinking costs visibility, never reachability.
 */
export function pickerVisibleRows(height: number, cap = PICKER_MAX_VISIBLE): number {
  return Math.max(PICKER_MIN_VISIBLE, Math.min(cap, height - PICKER_CHROME_ROWS))
}

export type PickerWindow = {
  items: readonly string[]
  start: number
  total: number
}

/* --------------------------------------------------------------------- */
/*  Pure helpers                                                          */
/* --------------------------------------------------------------------- */

/**
 * Strip CR/LF at the onInput edge: opentui's `<input>` inserts a literal `\n`
 * on enter (while also firing `onSubmit`), which renders as a stray glyph.
 * Shared with the rename-task dialog, which has the same quirk.
 */
export function stripNewlines(v: string): string {
  return v.replace(/[\r\n]+/g, "")
}

/**
 * No non-whitespace character. Unlike `trim() === ""`, also rejects Unicode
 * spaces `trim()` keeps — notably `U+3000` (`　`), which Chinese keyboards emit
 * constantly. JS `\s` covers `U+3000`, `U+00A0`, `U+2000–U+200A`, etc.
 */
export function isBlankText(v: string): boolean {
  return !/\S/u.test(v)
}

/**
 * Tab order, in visual order:
 *   existing:   tabs → [tier] → engine → [effort] → [model] → repo → baseRef → confirm → tabs
 *   clone:      tabs → [tier] → engine → [effort] → [model] → cloneUrl → cloneParent → cloneFolder → cloneBaseRef → confirm → tabs
 *   adopt:      tabs → [tier] → engine → [effort] → [model] → adoptFilter → confirm → tabs
 *
 * A stale cross-tab field restarts at the active tab's first input. Bracketed
 * stops exist only while rendered — focus parked on an unrendered stop
 * swallows every following keystroke.
 */
export function nextField(
  field: Field,
  tab: DialogTab = "existing",
  opts: { intentVisible?: boolean; effortVisible?: boolean; modelVisible?: boolean; tierVisible?: boolean } = {},
): Field {
  // Shared trailer — the selectors + Create button common to every tab.
  if (field === "confirm") return "tabs"
  if (field === "tabs") return opts.tierVisible ? "tier" : "engine"
  if (field === "tier") return "engine"
  if (field === "engine") return opts.modelVisible ? "model" : opts.effortVisible ? "effort" : firstFieldFor(tab)
  if (field === "model") return opts.effortVisible ? "effort" : firstFieldFor(tab)
  if (field === "effort") return firstFieldFor(tab)
  if (tab === "clone") {
    if (field === "cloneUrl") return "cloneParent"
    if (field === "cloneParent") return "cloneFolder"
    if (field === "cloneFolder") return "cloneBaseRef"
    if (field === "cloneBaseRef") return "confirm"
    return "cloneUrl"
  }
  if (tab === "adopt") {
    // List navigation is up/down on the rows, not Tab.
    return field === "adoptFilter" ? "confirm" : "adoptFilter"
  }
  // `intent` renders only for a repo with a project checkout (same
  // unrendered-stop rule as above).
  if (field === "repo") return opts.intentVisible ? "intent" : "baseRef"
  if (field === "intent") return "baseRef"
  if (field === "baseRef") return "confirm"
  return "repo"
}

/** First field for a sub-tab (used when switching tabs). */
export function firstFieldFor(tab: DialogTab): Field {
  if (tab === "clone") return "cloneUrl"
  if (tab === "adopt") return "adoptFilter"
  return "repo"
}

/**
 * Glob filter over absolute path AND basename (so `feature-*` works). Empty →
 * full list; an invalid pattern matches nothing instead of throwing.
 */
export function filterAdoptableByGlob<T extends { path: string }>(list: readonly T[], glob: string): readonly T[] {
  const pattern = glob.trim()
  if (!pattern) return list
  return list.filter((w) => matchPathGlob(pattern, w.path))
}

/** `defaultRepo` (launch cwd) first, then saved repos, deduped by path identity; blanks dropped. */
export function computeRepoOptions(defaultRepo: string, savedRepos: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of [defaultRepo, ...savedRepos]) {
    const t = p.trim()
    const key = pathIdentity(t)
    if (!t || seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/**
 * Basename (identifies) and directory (locates). Saved paths share a long
 * prefix, so leading with the basename puts the distinguishing word at a fixed
 * left edge. `dir` keeps its trailing slash so the halves concatenate back; no
 * slash or a trailing one → whole path as `base`, empty `dir`.
 */
export function splitRepoRow(path: string): { base: string; dir: string } {
  const at =
    pathSyntax(path).sep === "\\" ? Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) : path.lastIndexOf("/")
  if (at < 0 || at === path.length - 1) return { base: path, dir: "" }
  return { base: path.slice(at + 1), dir: path.slice(0, at + 1) }
}

/** Case-insensitive substring filter; empty query returns the list verbatim. */
export function filterRepos(all: readonly string[], query: string): readonly string[] {
  const q = query.trim().toLowerCase()
  if (!q) return all
  return all.filter((p) => p.toLowerCase().includes(q))
}

/** Same rules as {@link filterRepos}. */
export function filterBranches(all: readonly string[], query: string): readonly string[] {
  const q = query.trim().toLowerCase()
  if (!q) return all
  return all.filter((b) => b.toLowerCase().includes(q))
}

/** Cap visible rows (80+ branches mustn't push the dialog off-screen), scrolled to keep the cursor in view. */
export function windowAround(list: readonly string[], cursor: number, cap = PICKER_MAX_VISIBLE): PickerWindow {
  const total = list.length
  if (total <= cap) return { items: list, start: 0, total }
  const half = Math.floor(cap / 2)
  let start = Math.max(0, cursor - half)
  if (start + cap > total) start = total - cap
  return { items: list.slice(start, start + cap), start, total }
}

/** Clamp to [0, listLength - 1]; 0 for empty lists. */
export function clampCursor(cursor: number, listLength: number): number {
  if (listLength <= 0) return 0
  return Math.max(0, Math.min(listLength - 1, cursor))
}

/**
 * An exact case-insensitive match wins first — else substring filtering plus
 * cursor-reset-to-0 resolves `prod` to `preprod`. Then the highlighted row,
 * then free text (a tag/SHA the branch list doesn't know) or DEFAULT_BASE_REF.
 */
export function resolveBaseRef(typed: string, filteredBranches: readonly string[], cursor: number): string {
  const t = typed.trim()
  const lower = t.toLowerCase()
  const exact = t ? filteredBranches.find((b) => b.toLowerCase() === lower) : undefined
  if (exact) return exact
  const picked = filteredBranches[cursor]
  if (picked) return picked
  return t || DEFAULT_BASE_REF
}

/* --------------------------------------------------------------------- */
/*  Existing-tab intent                                                   */
/* --------------------------------------------------------------------- */

/**
 * What submitting the Existing tab does: "task" (default) branches a fresh
 * worktree; "project" opens the repo's own checkout (`main` row). "project" is
 * how a project hidden by closing its last tab (`isClosedDownProject`) comes
 * back — `createTask` always mints a `kind: "task"`.
 */
export type ExistingIntent = "task" | "project"

/**
 * Offer the choice only when `repo` already has a project checkout: `createTask`
 * mints one (via `ensureIfEligible`, state/project-eligibility.ts), this dialog
 * can't, so elsewhere the control would silently mean nothing. `mainRepos` is
 * normalized with the sidebar's grouping key.
 */
export function offersProjectIntent(repo: string, mainRepos: ReadonlySet<string>): boolean {
  const key = pathIdentity(repo.trim())
  return key.length > 0 && [...mainRepos].some((main) => pathIdentity(main) === key)
}
