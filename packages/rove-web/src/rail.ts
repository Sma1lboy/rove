/**
 * The Tasks rail's shape: project → task → tab, with the TUI's sort modes
 * (`project-groups.ts`), `/` filter (`tree-search.ts`) and status glyph
 * vocabulary (`tui/panes/sidebar/row-view.ts`, braille preset).
 */

import { fuzzyMatch } from "@sma1lboy/rove/src/tui/panes/sidebar/fuzzy.ts"
import type { TabRow, TaskRow } from "rove-bridge/protocol"
import type { GlyphSet } from "./prefs.ts"

export type SortMode = "default" | "recent" | "attention" | "name"
/** `t` cycles in this order, like `use-sidebar-host-state.ts`. */
export const SORT_MODES: readonly SortMode[] = ["default", "recent", "attention", "name"]

export interface ProjectGroup {
  readonly repo: string
  readonly label: string
  readonly tasks: readonly TaskRow[]
}

/** One keyboard-navigable rail row, top to bottom. */
export type NavRow =
  | { readonly id: string; readonly kind: "project"; readonly repo: string }
  | { readonly id: string; readonly kind: "task"; readonly task: TaskRow }
  | { readonly id: string; readonly kind: "tab"; readonly task: TaskRow; readonly tab: TabRow }
  /** One row folding a project's routine sessions (`tree-core.ts` `routines`). */
  | {
      readonly id: string
      readonly kind: "routines"
      readonly repo: string
      readonly tasks: readonly TaskRow[]
      readonly expanded: boolean
    }

const taskTime = (task: TaskRow): number => {
  const parsed = Date.parse(task.updatedAt ?? task.createdAt ?? "")
  return Number.isFinite(parsed) ? parsed : 0
}
// `groups.ts` compareRecent / compareName (not importable here: `@/` paths).
const compareRecent = (a: TaskRow, b: TaskRow): number => taskTime(b) - taskTime(a) || b.id.localeCompare(a.id)
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const compareName = (a: TaskRow, b: TaskRow): number =>
  collator.compare(a.title.trim(), b.title.trim()) || a.id.localeCompare(b.id)
/** `rank` is the bridge's task-group rank (needs a person next first), as `compareTaskGroup`. */
const compareAttention = (a: TaskRow, b: TaskRow): number => a.rank - b.rank || compareRecent(a, b)

const COMPARE: Record<SortMode, ((a: TaskRow, b: TaskRow) => number) | null> = {
  default: null,
  recent: compareRecent,
  attention: compareAttention,
  name: compareName,
}

export const routinesRowId = (repo: string): string => `~routines:${repo}`

export const repoLabel = (repo: string): string => repo.split("/").filter(Boolean).pop() ?? repo

export function groupByProject(tasks: readonly TaskRow[], sort: SortMode = "default"): ProjectGroup[] {
  const ordered = [...tasks].sort((a, b) => (a.order ?? a.rank) - (b.order ?? b.rank))
  const groups = new Map<string, TaskRow[]>()
  for (const task of ordered) {
    const list = groups.get(task.repo)
    // The project's main checkout heads its group, whatever the sort.
    if (list) task.kind === "main" ? list.unshift(task) : list.push(task)
    else groups.set(task.repo, [task])
  }
  const compare = COMPARE[sort]
  return [...groups].map(([repo, rows]) => ({
    repo,
    label: repoLabel(repo),
    tasks: compare
      ? rows.sort((a, b) => ((a.kind === "main") === (b.kind === "main") ? compare(a, b) : a.kind === "main" ? -1 : 1))
      : rows,
  }))
}

/**
 * Flatten to navigable rows, pruned to `query` like `filterTreeRows`: each field
 * matched on its own; a project hit keeps its whole subtree, a task hit its tabs,
 * a tab hit its task and project.
 */
export function navRows(
  groups: readonly ProjectGroup[],
  tabsOf: (taskId: string) => readonly TabRow[],
  tabLabel: (tab: TabRow) => string,
  query = "",
  expandedRoutines: ReadonlySet<string> = new Set(),
): NavRow[] {
  const q = query.trim()
  const hit = (...fields: string[]) => fields.some((f) => f !== "" && fuzzyMatch(q, f))
  const rows: NavRow[] = []
  for (const group of groups) {
    const projectHit = q === "" || hit(group.label)
    const under: NavRow[] = []
    const routines: TaskRow[] = []
    const routineRows: NavRow[] = []
    for (const task of group.tasks) {
      const tabs = tabsOf(task.id)
      const taskHit = projectHit || hit(task.title, task.branch, repoLabel(task.repo))
      const tabRows = tabs
        .filter((tab) => taskHit || hit(tabLabel(tab)))
        .map((tab): NavRow => ({ id: `${task.id}::${tab.id}`, kind: "tab", task, tab }))
      if (!taskHit && tabRows.length === 0) continue
      // Routine sessions are the tail of the group: a count row folds them.
      if (task.routine) {
        routines.push(task)
        routineRows.push({ id: task.id, kind: "task", task }, ...tabRows)
      } else under.push({ id: task.id, kind: "task", task }, ...tabRows)
    }
    if (routines.length > 0) {
      // Search builds fully open, so a folded routine stays findable.
      const expanded = q !== "" || expandedRoutines.has(group.repo)
      under.push({ id: routinesRowId(group.repo), kind: "routines", repo: group.repo, tasks: routines, expanded })
      if (expanded) under.push(...routineRows)
    }
    if (under.length === 0 && !projectHit) continue
    rows.push({ id: `project:${group.repo}`, kind: "project", repo: group.repo }, ...under)
  }
  return rows
}

export type Tone = "accent" | "muted" | "attention" | "warning" | "success" | "ink"

/** The state marks a row draws, from the chosen glyph set (`tui/lib/glyphs.ts`); braille until the bridge answers. */
export type RowGlyphs = Pick<GlyphSet, "spinner" | "idle" | "unseen" | "needsInput" | "attention">

/** `engine/spinner-frames.ts` DEFAULT_SPINNER_FRAMES with the braille preset's marks. */
export const BRAILLE: RowGlyphs = {
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  idle: "○",
  unseen: "●",
  needsInput: "?",
  attention: "!",
}

export function activityGlyph(
  state: string | undefined,
  frame: number,
  glyphs: RowGlyphs = BRAILLE,
): { glyph: string; tone: Tone } {
  switch (state) {
    case "running":
      return { glyph: glyphs.spinner[frame % glyphs.spinner.length] ?? glyphs.idle, tone: "accent" }
    case "permission_needed":
      return { glyph: glyphs.needsInput, tone: "warning" }
    case "rate_limited":
    case "error":
    case "dead":
      return { glyph: glyphs.attention, tone: "attention" }
    case "turn_complete":
      return { glyph: glyphs.unseen, tone: "accent" }
    default:
      return { glyph: glyphs.idle, tone: "muted" }
  }
}
