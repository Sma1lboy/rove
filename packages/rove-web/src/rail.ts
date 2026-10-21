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

/** Rows under another machine's header carry its alias: read-only here, as the TUI's machine layer. */
interface Remote {
  readonly machine?: string
}

/** One keyboard-navigable rail row, top to bottom. */
export type NavRow =
  | (Remote & { readonly id: string; readonly kind: "project"; readonly repo: string; readonly label: string })
  | (Remote & { readonly id: string; readonly kind: "task"; readonly task: TaskRow })
  | (Remote & { readonly id: string; readonly kind: "tab"; readonly task: TaskRow; readonly tab: TabRow })
  /** One row folding a project's routine sessions (`tree-core.ts` `routines`); `key` names the fold in `expandedRoutines`. */
  | (Remote & {
      readonly id: string
      readonly kind: "routines"
      readonly repo: string
      readonly key: string
      readonly tasks: readonly TaskRow[]
      readonly expanded: boolean
    })

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

export const routinesRowId = (key: string): string => `~routines:${key}`

export const repoLabel = (repo: string): string => repo.split("/").filter(Boolean).pop() ?? repo

/** A repo as the label rules see it: its path plus the host it lives on (`""` = this Mac). */
export interface LabelledRepo {
  readonly repo: string
  readonly host: string
}

/**
 * `groups.ts` `sidebarProjectLabel` (not importable here: `@/` paths): the narrowest unique header label.
 * A basename unique on screen reads `rove`; shared on one machine, the last two segments (`gihub/rove`);
 * shared only with another machine, `host:basename` (`narwhal:rove`), the local one keeping the bare name.
 */
export function projectLabel(repo: string, repos: readonly LabelledRepo[], host = ""): string {
  const base = repoLabel(repo)
  const collisions = repos.filter(
    (entry) => (entry.repo !== repo || entry.host !== host) && repoLabel(entry.repo) === base,
  )
  if (collisions.length === 0) return base
  const tailOf = (path: string) => path.split("/").filter(Boolean).slice(-2).join("/")
  if (collisions.some((entry) => entry.host === host)) {
    const tailRepeats = collisions.some((entry) => entry.host !== host && tailOf(entry.repo) === tailOf(repo))
    return tailRepeats && host ? `${host}:${tailOf(repo)}` : tailOf(repo)
  }
  return host ? `${host}:${base}` : base
}

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
  /** The machine these groups came from; ids and fold keys carry it so two machines' same path never collide. */
  machine?: string,
): NavRow[] {
  const q = query.trim()
  const hit = (...fields: string[]) => fields.some((f) => f !== "" && fuzzyMatch(q, f))
  const remote: Remote = machine === undefined ? {} : { machine }
  const scope = machine === undefined ? "" : `${machine}\0`
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
        .map((tab): NavRow => ({ id: `${task.id}::${tab.id}`, kind: "tab", task, tab, ...remote }))
      if (!taskHit && tabRows.length === 0) continue
      // Routine sessions are the tail of the group: a count row folds them.
      if (task.routine) {
        routines.push(task)
        routineRows.push({ id: task.id, kind: "task", task, ...remote }, ...tabRows)
      } else under.push({ id: task.id, kind: "task", task, ...remote }, ...tabRows)
    }
    if (routines.length > 0) {
      // Search builds fully open, so a folded routine stays findable.
      const key = `${scope}${group.repo}`
      const expanded = q !== "" || expandedRoutines.has(key)
      under.push({
        id: routinesRowId(key),
        kind: "routines",
        repo: group.repo,
        key,
        tasks: routines,
        expanded,
        ...remote,
      })
      if (expanded) under.push(...routineRows)
    }
    if (under.length === 0 && !projectHit) continue
    rows.push(
      { id: `project:${scope}${group.repo}`, kind: "project", repo: group.repo, label: group.label, ...remote },
      ...under,
    )
  }
  return rows
}

export interface RailInput {
  /** This machine's rows. */
  readonly tasks: readonly TaskRow[]
  /** Other machines' rows, each with `machine` set. */
  readonly remote: readonly TaskRow[]
  /** Registered machines in registration order; a remote row whose machine is not here is dropped. */
  readonly machines: readonly { readonly alias: string; readonly hostLabel: string }[]
  readonly sort: SortMode
  readonly tabsOf: (taskId: string) => readonly TabRow[]
  readonly tabLabel: (tab: TabRow) => string
  readonly query: string
  readonly routines: ReadonlySet<string>
}

const newest = (group: ProjectGroup): number => Math.max(0, ...group.tasks.map(taskTime))

/**
 * The whole rail as ONE list of projects from every machine, the way Claude Desktop lists sessions
 * from every environment together: no per-machine section, a remote project carries its machine on
 * its header row instead. `default` keeps this machine's own project order first, then each machine's
 * in registration order; `recent` and `name` interleave all of them. A remote task lists its tabs
 * like a local one (read from its own machine). `groups` is this machine's projects, labelled against
 * every project on screen.
 */
export function railRows(input: RailInput): { rows: NavRow[]; groups: ProjectGroup[] } {
  const sections = input.machines.map((machine) => ({
    machine,
    host: machine.hostLabel || machine.alias,
    groups: groupByProject(
      input.remote.filter((task) => task.machine?.id === machine.alias),
      input.sort,
    ),
  }))
  const local = groupByProject(input.tasks, input.sort)
  const onScreen: LabelledRepo[] = [
    ...local.map((group) => ({ repo: group.repo, host: "" })),
    ...sections.flatMap((s) => s.groups.map((group) => ({ repo: group.repo, host: s.host }))),
  ]
  const labelled = (groups: readonly ProjectGroup[], host: string) =>
    groups.map((group) => ({ ...group, label: projectLabel(group.repo, onScreen, host) }))
  const groups = labelled(local, "")
  const all: { group: ProjectGroup; machine?: string }[] = [
    ...groups.map((group) => ({ group })),
    ...sections.flatMap((s) => labelled(s.groups, s.host).map((group) => ({ group, machine: s.machine.alias }))),
  ]
  if (input.sort === "recent") all.sort((a, b) => newest(b.group) - newest(a.group))
  if (input.sort === "name") all.sort((a, b) => collator.compare(a.group.label, b.group.label))
  const rows = all.flatMap(({ group, machine }) =>
    machine === undefined
      ? navRows([group], input.tabsOf, input.tabLabel, input.query, input.routines)
      : navRows([group], input.tabsOf, input.tabLabel, input.query, input.routines, machine),
  )
  return { rows, groups }
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
