/**
 * Pure state-machine helpers for the new-task dialog.
 *
 * Kept separate so the dialog's logic — field cycling, repo-list
 * assembly, substring filtering, picker windowing — can be unit-tested
 * without standing up the dialog stack or opentui. None of these
 * functions touch React, opentui, the filesystem, or a subprocess; they
 * are effectively reducers + pure helpers. **Keep this file
 * framework-free AND side-effect-free** — anything that shells out or
 * reads the fs lives elsewhere:
 *
 *   - sync git snapshots (current branch, branch list, repo
 *     validation) → `src/tui/lib/git-snapshot.ts` (the sync-guard
 *     whitelist entry lives there, not here).
 *   - path/dir suggestion plumbing (`expandHome`, drill-down listing)
 *     → `src/tui/lib/path-helpers.ts`.
 *   - clone-tab fs/spawn helpers → `./clone.ts`.
 *
 * The React dialog cluster (`src/tui-react/component/new-task-dialog/`)
 * imports all of these and wires them to component state.
 */

import { matchPathGlob } from "@/lib/path-glob"
import type { VendorId } from "@/types/vendor"
import type { AdoptableWorktree } from "@/types/worktree"
import { DEFAULT_BASE_REF } from "../../lib/git-snapshot"

/* --------------------------------------------------------------------- */
/*  Public types                                                          */
/* --------------------------------------------------------------------- */

/**
 * Result of a successful submit. `cloned` is set when the user came in
 * via the New Repo tab — the clone has already completed at this point
 * and `repo` is the freshly-cloned worktree path. The caller uses the
 * presence of `cloned` to persist `lastClonedRepoParent` and add `repo`
 * to the saved-repos list so it shows up in the existing-tab picker
 * next time.
 */
/**
 * Dialog result. Three shapes, discriminated by `mode`:
 *   - create (default) — make a fresh task on `repo` at `baseRef`.
 *   - adopt — import one or more EXISTING git worktrees as tasks
 *. `adopt` carries the chosen worktrees; the caller loops
 *     `orchestrator.adoptWorktree` over them.
 *   - open — open `repo`'s OWN checkout (its `main` row) rather than
 *     branching a worktree off it. The only way back to a project the
 *     sidebar has hidden (`isClosedDownProject`): every other path through
 *     this dialog mints a `kind: "task"`, so picking the repo used to leave
 *     the user with an extra worktree and still no project row.
 */
export type NewTaskInput =
  | {
      mode?: "create"
      repo: string
      baseRef: string
      /** Engine the task runs on. Defaults to the user's last-selected vendor. */
      vendor: VendorId
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
 * Which sub-tab the dialog is showing:
 *   - "existing" — pick an existing local repo + branch (legacy behavior).
 *   - "clone"    — clone a remote repo, then create a task on the clone.
 *
 * Switched via Ctrl+[ / Ctrl+] while the dialog is open. With only two
 * tabs the chord pair behaves as a toggle.
 */
/**
 * Caller-supplied options for opening the new-task dialog. Framework-free
 * so the shared create flow (`lib/task-actions.ts`) can type its
 * `promptNewTask` adapter without importing a JSX shell. The React dialog
 * (`src/tui-react/component/new-task-dialog`) implements `show(...)` against
 * this shape.
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
   * Repos that already have a project checkout (a `main` task), trimmed of
   * trailing slashes. The Existing tab offers "open the project" only for
   * these — see {@link offersProjectIntent}. Omitted/empty simply means the
   * choice never appears and the tab behaves as it always did.
   */
  mainRepos?: ReadonlySet<string>
}

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
 * Field states for the dialog. Two are shared across every sub-tab and
 * sit at the top of the visual order:
 *   - `tabs`   — the mode-tab selector (For Existing / New Repo / Adopt).
 *                ←/→ switches the active sub-tab while it's focused.
 *   - `engine` — the vendor selector. ←/→ (and ctrl+e from anywhere)
 *                cycles the engine while it's focused.
 * Below them each sub-tab has its own inputs: "existing" uses `repo` /
 * `baseRef`; "clone" uses `cloneUrl` / `cloneParent` / `cloneFolder` /
 * `cloneBaseRef`; "adopt" uses `adoptFilter`. `confirm` is the bottom-
 * right Create button, shared by all tabs. Tab walks the whole chain so
 * the selectors AND the Create button are reachable by keyboard.
 */
export type Field =
  | "tabs"
  | "engine"
  | "repo"
  | "baseRef"
  | "cloneUrl"
  | "cloneParent"
  | "cloneFolder"
  | "cloneBaseRef"
  | "adoptFilter"
  | "confirm"

/**
 * Which list the unified picker should render under the repo input.
 *   - "saved" — substring-filtered against the curated saved-repo
 *     list (cwd + /add-repo entries). Default when the input is empty
 *     or doesn't look like a path.
 *   - "browse" — directory drill-down. Engaged when the input looks
 *     like a path (`/...` or `~/...`) AND doesn't exactly match a
 *     saved repo — exact-match keeps "saved" so the cwd default doesn't
 *     jarringly render as a parent-dir browse on dialog open.
 */
export type PickerMode = "saved" | "browse"

/**
 * Decide which list the unified picker should render for the current
 * input. `repoOptions` is the assembled saved-repo list (already
 * deduped by `computeRepoOptions`) — pass it so we can short-circuit
 * to "saved" when the typed value is an exact match (e.g. the
 * cwd-prefilled state on dialog open).
 */
export function pickerModeFor(value: string, repoOptions: readonly string[]): PickerMode {
  const trimmed = value.trim()
  if (repoOptions.includes(trimmed)) return "saved"
  if (trimmed.startsWith("~")) return "browse"
  if (trimmed.includes("/")) return "browse"
  return "saved"
}

/** Picker windowing cap on a terminal with room. Matches the slash
 *  dropdown's `slashWindow`. */
export const PICKER_MAX_VISIBLE = 8

/**
 * Terminal rows the dialog needs for everything that is NOT the open picker.
 * Counted off the rendered Existing tab (the tallest of the three): title,
 * mode row, engine label + choices, both field labels + inputs, the picker's
 * overflow lines, the action row and the card's padding — plus the vertical
 * margin `Dialog` keeps outside the card, since the budget here is the
 * TERMINAL's height, not the card's.
 */
const PICKER_CHROME_ROWS = 22
/** The floor. Two rows plus the `↓ N more` line still reads as a list and
 *  still scrolls under the cursor, so nothing becomes unreachable; going
 *  lower would leave the cursor with nowhere to sit. */
const PICKER_MIN_VISIBLE = 2

/**
 * Visible picker rows for a viewport `height` rows tall.
 *
 * The cap used to be a flat 8 regardless of terminal height, so the dialog's
 * own height was a constant while the space for it was not: on a 24-row
 * terminal the card overran `maxCardHeight` and the bottom rows — the Create
 * button and, worse, `submitError` — were clipped away with nothing to
 * scroll them back. A failed create then looked like nothing happening at
 * all. Shrinking the window is what gives those rows back; the list is
 * already windowed and scrolls under the cursor, so a shorter window costs
 * only how much is visible at once, never reachability.
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
 * Strip CR/LF from a single-line input value. opentui's `<input>`
 * happily inserts a literal `\n` when the user presses enter inside a
 * focused field — even though the same press also fires `onSubmit` —
 * so the value rendered back to the field shows the stray newline as
 * a glyph (looks like an extra "n" on macOS terminals). We sanitize at
 * the onInput edge so the signal never carries a newline; the
 * onSubmit handler still fires and commits the trimmed-but-newline-
 * free value.
 *
 * Exported so the rename-task dialog (which shares the same opentui
 * input quirk) can reuse it without re-importing from app.tsx.
 */
export function stripNewlines(v: string): string {
  return v.replace(/[\r\n]+/g, "")
}

/**
 * Is a required free-text field effectively empty?
 *
 * `true` when the string carries no non-whitespace character. Unlike a
 * bare `value.trim() === ""` guard, this rejects strings made only of
 * Unicode whitespace that `String.prototype.trim()` does NOT strip — most
 * importantly the full-width / ideographic space `U+3000` (`　`), which a
 * Chinese keyboard emits constantly. JS `\s` (and thus `\S`) already covers
 * `U+3000`, `U+00A0`, `U+2000–U+200A`, etc., so a prompt/title of only
 * those spaces is correctly treated as blank instead of slipping past the
 * submit guard as a real value.
 */
export function isBlankText(v: string): boolean {
  return !/\S/u.test(v)
}

/**
 * Advance the field-cycle state. Tab walks the full chain in visual
 * order, threading the two shared selectors (`tabs`, `engine`) and the
 * shared `confirm` button into every sub-tab:
 *   existing:   tabs → engine → repo → baseRef → confirm → tabs
 *   clone:      tabs → engine → cloneUrl → cloneParent → cloneFolder → cloneBaseRef → confirm → tabs
 *   adopt:      tabs → engine → adoptFilter → confirm → tabs
 *
 * The `confirm → tabs → engine → <first input>` trailer is shared, so
 * tabbing past Create lands back on the selectors rather than stranding
 * the user. A stale cross-tab input field restarts the active tab's
 * cycle at its first input.
 */
export function nextField(field: Field, tab: DialogTab = "existing"): Field {
  // Shared trailer — the selectors + Create button common to every tab.
  if (field === "confirm") return "tabs"
  if (field === "tabs") return "engine"
  if (field === "engine") return firstFieldFor(tab)
  if (tab === "clone") {
    if (field === "cloneUrl") return "cloneParent"
    if (field === "cloneParent") return "cloneFolder"
    if (field === "cloneFolder") return "cloneBaseRef"
    if (field === "cloneBaseRef") return "confirm"
    return "cloneUrl"
  }
  if (tab === "adopt") {
    // One input stop (the glob filter) then the Create (= Adopt) button.
    // List navigation is up/down on the rows, not Tab.
    return field === "adoptFilter" ? "confirm" : "adoptFilter"
  }
  if (field === "repo") return "baseRef"
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
 * Filter adoptable worktrees by a path glob. Empty glob → the
 * full list. Matches against the absolute path AND the basename, so a
 * bare `feature-*` works without typing the full directory. Uses Bun's
 * built-in `Glob` (zero-dep). An invalid pattern matches nothing rather
 * than throwing — the dialog keeps rendering.
 */
export function filterAdoptableByGlob<T extends { path: string }>(list: readonly T[], glob: string): readonly T[] {
  const pattern = glob.trim()
  if (!pattern) return list
  return list.filter((w) => matchPathGlob(pattern, w.path))
}

/**
 * Build the deduped repo option list. `defaultRepo` (cwd at launch)
 * is always first; user-saved repos follow, deduped against the cwd
 * and any whitespace-only entries. Returns a fresh array on each call
 * so the caller can pass it straight into a memo.
 */
export function computeRepoOptions(defaultRepo: string, savedRepos: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of [defaultRepo, ...savedRepos]) {
    const t = p.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/**
 * Split a saved-repo path into the part that IDENTIFIES it and the part that
 * merely LOCATES it: the basename, and everything before it.
 *
 * The saved list is a column of absolute paths that share a prefix
 * (`/Users/me/i/kobe`, `/Users/me/i/wisp`, …), so the leading run of
 * characters is identical on every row and the one distinguishing word sits
 * far right, past the ragged part. Leading with the basename puts the answer
 * at a fixed left edge and demotes the directory to context the eye can skip.
 *
 * `dir` keeps its trailing slash so the two halves concatenate back to the
 * original path — the row shows the same string, only re-ordered and
 * re-weighted. A path with no slash (or a trailing one, which names no leaf)
 * has nothing to split: it comes back whole as `base` with an empty `dir`,
 * so the row renders exactly as it did before.
 */
export function splitRepoRow(path: string): { base: string; dir: string } {
  const at = path.lastIndexOf("/")
  if (at < 0 || at === path.length - 1) return { base: path, dir: "" }
  return { base: path.slice(at + 1), dir: path.slice(0, at + 1) }
}

/**
 * Case-insensitive substring filter for the repo picker. Empty query
 * returns the full list verbatim.
 */
export function filterRepos(all: readonly string[], query: string): readonly string[] {
  const q = query.trim().toLowerCase()
  if (!q) return all
  return all.filter((p) => p.toLowerCase().includes(q))
}

/**
 * Case-insensitive substring filter for the branch picker. Same rules
 * as the repo filter — empty query returns everything; non-empty does
 * a substring match.
 */
export function filterBranches(all: readonly string[], query: string): readonly string[] {
  const q = query.trim().toLowerCase()
  if (!q) return all
  return all.filter((b) => b.toLowerCase().includes(q))
}

/**
 * Windowing helper — same shape as the slash dropdown's
 * `slashWindow`. Caps visible rows so a repo with 80+ branches doesn't
 * push the rest of the dialog off-screen; the window scrolls to keep
 * the cursor in view.
 */
export function windowAround(list: readonly string[], cursor: number, cap = PICKER_MAX_VISIBLE): PickerWindow {
  const total = list.length
  if (total <= cap) return { items: list, start: 0, total }
  const half = Math.floor(cap / 2)
  let start = Math.max(0, cursor - half)
  if (start + cap > total) start = total - cap
  return { items: list.slice(start, start + cap), start, total }
}

/**
 * Clamp the picker cursor to the available range [0, list.length - 1].
 * Returns 0 for empty lists.
 */
export function clampCursor(cursor: number, listLength: number): number {
  if (listLength <= 0) return 0
  return Math.max(0, Math.min(listLength - 1, cursor))
}

/**
 * Resolve the baseRef the dialog should submit. An EXACT (case-
 * insensitive) match of the trimmed typed text against the filtered
 * branch list wins first — otherwise a substring-filtered list plus the
 * cursor-reset-to-0 behavior would resolve `prod` to `preprod` (the
 * alphabetically-first branch that merely *contains* the typed text).
 * Falling back to the highlighted row (cursor) is right only when the
 * typed text isn't itself a branch name; free-text (or DEFAULT_BASE_REF)
 * kicks in last when nothing in the list matches at all — e.g. a tag /
 * commit SHA the local branch list doesn't know.
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
/*  Existing-tab intent (issue #90)                                       */
/* --------------------------------------------------------------------- */

/**
 * What submitting the Existing tab should DO with the chosen repo:
 *   - "task"    — branch a fresh worktree task off it (what this tab
 *                 has always done, and still the default).
 *   - "project" — open the repo's OWN checkout, its `main` row.
 *
 * The second exists because it was the missing half. Closing a project's
 * last tab hides it from the sidebar (`isClosedDownProject`), and the
 * comment there promised the repo was "still there in the new-task picker
 * to open again" — but every submit path went through `createTask`, which
 * always mints a `kind: "task"`. Picking the hidden repo therefore added a
 * worktree beside the project instead of returning to it.
 */
export type ExistingIntent = "task" | "project"

/**
 * Whether the Existing tab should offer the intent choice for `repo`.
 *
 * Only when that repo ALREADY has a project checkout: opening the main row
 * of a repo that has none is not a thing this dialog can do — `createTask`
 * is what mints one, via `ensureIfEligible`, and only for a repo the
 * admission gate accepts (state/project-eligibility.ts). Offering the
 * choice everywhere would put a second control on the tab that silently
 * means nothing most of the time.
 *
 * `mainRepos` is the set of repo paths that have a `main` task, normalized
 * by the caller with the same key the sidebar groups on.
 */
export function offersProjectIntent(repo: string, mainRepos: ReadonlySet<string>): boolean {
  const trimmed = repo.trim().replace(/[\\/]+$/, "")
  return trimmed.length > 0 && mainRepos.has(trimmed)
}
