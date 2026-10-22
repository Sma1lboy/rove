/**
 * The Tasks rail's shape: project → task → tab, with the TUI's sort modes
 * (`project-groups.ts`) and `/` filter (`tree-search.ts`), and what each row's
 * status mark is: the daemon's row status (`row.status`) through the one mapping
 * every client uses (`rove/src/lib/row-status-glyph.ts`).
 */

import { type RowTone, rowStatusGlyph } from "@sma1lboy/rove/src/lib/row-status-glyph.ts"
import { fuzzyMatch } from "@sma1lboy/rove/src/tui/panes/sidebar/fuzzy.ts"
import type { RowStatus, TabRow, TabStatus, TaskRow } from "rove-bridge/protocol"
import type { GlyphSet } from "./prefs.ts"

export type SortMode = "default" | "recent" | "attention" | "name"
/** `t` cycles in this order, like `use-sidebar-host-state.ts`. */
export const SORT_MODES: readonly SortMode[] = ["default", "recent", "attention", "name"]

export interface ProjectGroup {
  /** The checkout project-level actions use: this machine's when it has one, else the first machine's. */
  readonly repo: string
  readonly label: string
  readonly tasks: readonly TaskRow[]
  /** The repo across machines (bridge `TaskRow.repoId`); absent outside a repo. */
  readonly repoId?: string
  /** Row ids and fold keys: the repo id, else the (machine-scoped) path. Defaults to `repo`. */
  readonly key?: string
  /** The machine `repo` lives on; absent = this one. */
  readonly machine?: string
}

/** A row from another machine carries its alias, so its menu and keys run there. */
interface Remote {
  readonly machine?: string
}

/** One keyboard-navigable rail row, top to bottom. */
export type NavRow =
  | (Remote & {
      readonly id: string
      readonly kind: "project"
      readonly repo: string
      readonly label: string
    })
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
  return [...groups].map(([repo, rows]) => {
    const repoId = rows.find((task) => task.repoId)?.repoId
    return {
      repo,
      label: repoLabel(repo),
      tasks: compare ? rows.sort(mainFirst(compare)) : rows,
      ...(repoId ? { repoId } : {}),
    }
  })
}

/** The project's main checkouts head its group, whatever the sort. */
const mainFirst =
  (compare: (a: TaskRow, b: TaskRow) => number) =>
  (a: TaskRow, b: TaskRow): number =>
    (a.kind === "main") === (b.kind === "main") ? compare(a, b) : a.kind === "main" ? -1 : 1

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
    const head: Remote = group.machine === undefined ? {} : { machine: group.machine }
    const key = group.key ?? group.repo
    const under: NavRow[] = []
    const routines: TaskRow[] = []
    const routineRows: NavRow[] = []
    for (const task of group.tasks) {
      const remote: Remote = task.machine ? { machine: task.machine.id } : {}
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
      const expanded = q !== "" || expandedRoutines.has(key)
      under.push({
        id: routinesRowId(key),
        kind: "routines",
        repo: group.repo,
        key,
        tasks: routines,
        expanded,
        ...head,
      })
      if (expanded) under.push(...routineRows)
    }
    if (under.length === 0 && !projectHit) continue
    rows.push(
      {
        id: `project:${key}`,
        kind: "project",
        repo: group.repo,
        label: group.label,
        ...head,
      },
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

/** One machine's checkout of a project: a per-path group plus the machine it lives on (absent = this one). */
interface Part {
  readonly group: ProjectGroup
  readonly machine?: string
}

type Project = ProjectGroup

/** `owner/name` of a `host/owner/name` id; a `root:` id has no readable name. */
const repoIdTail = (id: string): string | null => (id.startsWith("root:") ? null : id.split("/").slice(-2).join("/"))

/**
 * The repo's basename, widened only when a DIFFERENT project shares it: a repo id reads `owner/name`
 * (the whole id when even that repeats), a path-only project its path tail ({@link projectLabel} with
 * every checkout as one host): the header never names a machine, the rows' cloud marks do.
 */
function mergedLabel(project: Project, all: readonly Project[]): string {
  const base = repoLabel(project.repo)
  const others = all.filter((other) => other !== project && repoLabel(other.repo) === base)
  if (others.length === 0) return base
  const id = project.repoId
  const tail = id ? repoIdTail(id) : null
  if (id && tail) {
    return others.some((other) => other.repoId && other.repoId !== id && repoIdTail(other.repoId) === tail) ? id : tail
  }
  return projectLabel(
    project.repo,
    [project, ...others].map((entry) => ({ repo: entry.repo, host: "" })),
  )
}

/**
 * The whole rail as ONE list of projects from every machine, the way Claude Desktop lists sessions
 * from every environment together. A repo is one project wherever it is checked out: groups with the
 * same `repoId` merge into one header (keyed by that id), its tasks from every machine underneath,
 * each row keeping its own `machine`; groups without one stay per machine and path. The header acts
 * on this machine's checkout when there is one, else the first machine's, and names no machine:
 * a task row from elsewhere carries a cloud mark instead (`rail-view.tsx`). `default` keeps this
 * machine's project order first, then each machine's in registration order; `recent` and `name` interleave all of them. `groups` is this machine's
 * per-path projects, labelled as their headers.
 */
export function railRows(input: RailInput): { rows: NavRow[]; groups: ProjectGroup[] } {
  const parts: Part[] = [
    ...groupByProject(input.tasks, input.sort).map((group) => ({ group })),
    ...input.machines.flatMap((machine) =>
      groupByProject(
        input.remote.filter((task) => task.machine?.id === machine.alias),
        input.sort,
      ).map((group) => ({ group, machine: machine.alias })),
    ),
  ]
  const buckets = new Map<string, Part[]>()
  for (const part of parts) {
    const { repoId, repo } = part.group
    const key = repoId ?? (part.machine === undefined ? repo : `${part.machine}\0${repo}`)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(part)
    else buckets.set(key, [part])
  }
  const compare = COMPARE[input.sort]
  const projectOf = new Map<Part, Project>()
  const projects: Project[] = []
  for (const [key, bucket] of buckets) {
    const head = bucket[0]
    if (!head) continue
    const all = bucket.flatMap((part) => part.group.tasks)
    const project: Project = {
      repo: head.group.repo,
      label: "",
      key,
      tasks:
        bucket.length === 1
          ? head.group.tasks
          : compare
            ? all.sort(mainFirst(compare))
            : [...all.filter((task) => task.kind === "main"), ...all.filter((task) => task.kind !== "main")],
      ...(head.group.repoId ? { repoId: head.group.repoId } : {}),
      ...(head.machine === undefined ? {} : { machine: head.machine }),
    }
    projects.push(project)
    for (const part of bucket) projectOf.set(part, project)
  }
  const labels = new Map(projects.map((project) => [project, mergedLabel(project, projects)]))
  const labelled = projects.map((project) => ({ ...project, label: labels.get(project) ?? project.label }))
  if (input.sort === "recent") labelled.sort((a, b) => newest(b) - newest(a))
  if (input.sort === "name") labelled.sort((a, b) => collator.compare(a.label, b.label))
  const rows = navRows(labelled, input.tabsOf, input.tabLabel, input.query, input.routines)
  const groups = parts
    .filter((part) => part.machine === undefined)
    .map((part) => {
      const project = projectOf.get(part)
      return { ...part.group, label: (project && labels.get(project)) ?? part.group.label }
    })
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

/** The web palette for a status tone: a wait you can clear is amber, what stays broken is red. */
const TONE: Readonly<Record<RowTone, Tone>> = {
  accent: "accent",
  warning: "warning",
  error: "attention",
  muted: "muted",
}

export interface StatusMark {
  readonly glyph: string
  readonly tone: Tone
  readonly spinning: boolean
}

/** A daemon status as a rail draws it; no status (no reading yet) is a quiet row. */
export function statusGlyph(status: RowStatus | undefined, frame: number, glyphs: RowGlyphs = BRAILLE): StatusMark {
  const mark = rowStatusGlyph(status, glyphs, frame)
  return { glyph: mark.glyph, tone: TONE[mark.tone], spinning: mark.spinning }
}

/** The daemon's status of one of a task's tabs: the pushed one on the row, else the one read with the tab list. */
export function tabStatusOf(task: TaskRow, tab: TabRow): TabStatus | undefined {
  return task.tabStatus?.[tab.id] ?? tab.status
}

/** A tab row's mark: its own status (a dead tab the daemon says nothing about stays a muted idle). */
export function tabRowGlyph(task: TaskRow, tab: TabRow, frame: number, glyphs: RowGlyphs = BRAILLE): StatusMark {
  return statusGlyph(tabStatusOf(task, tab), frame, glyphs)
}

/**
 * A task row's mark. The rollup is what a folded row shows: with its tabs listed underneath, each
 * tab shows its own and the task row shows none, except a task-level job or deletion (`busy`),
 * which belongs to no tab.
 */
export function taskRowGlyph(task: TaskRow, frame: number, glyphs: RowGlyphs = BRAILLE): StatusMark | null {
  // Status lives on tab rows; a task row only spins while its worktree is made or the task deleted.
  if (task.rowStatus?.kind !== "busy") return null
  return statusGlyph(task.rowStatus, frame, glyphs)
}

/** Some row on screen spins: the shared spinner clock must tick. */
export function anySpinning(tasks: readonly TaskRow[]): boolean {
  const spins = (status: RowStatus | undefined) => status?.kind === "running" || status?.kind === "busy"
  return tasks.some((task) => spins(task.rowStatus) || Object.values(task.tabStatus ?? {}).some(spins))
}

/** A folded group's rows that need a person: something to answer or something broken. */
export function needsPerson(task: TaskRow): boolean {
  return task.rowStatus?.kind === "needs-input" || task.rowStatus?.kind === "attention"
}

/**
 * How many `task.move` steps take `from` to `to`'s place, in the daemon's move partition
 * (`movePartition`): all mains (projects), or one repo's tasks with the same pin. Null across partitions.
 */
export function dragSteps(tasks: readonly TaskRow[], from: TaskRow, to: TaskRow): number | null {
  const main = from.kind === "main"
  const same = (task: TaskRow) =>
    main ? task.kind === "main" : task.kind !== "main" && task.repo === from.repo && !task.pinned === !from.pinned
  if (from.id === to.id || !same(to)) return null
  const ids = tasks
    .filter(same)
    .sort((a, b) => (a.order ?? a.rank) - (b.order ?? b.rank))
    .map((task) => task.id)
  return ids.indexOf(to.id) - ids.indexOf(from.id)
}
