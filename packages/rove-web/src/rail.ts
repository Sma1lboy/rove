/**
 * The Tasks rail's shape: project → task → child tasks, with the TUI's sort modes
 * (`project-groups.ts`) and `/` filter (`tree-search.ts`). The status marks
 * rows draw live in `rail-glyphs.ts`.
 */

import { fuzzyMatch } from "@sma1lboy/rove/src/tui/panes/sidebar/fuzzy.ts"
import type { TabRow, TaskRow } from "rove-bridge/protocol"

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

/** What a task row says about its children: every descendant (not just direct ones), and their ids so a folded row can rank them. */
export interface RowFold {
  readonly count: number
  readonly collapsed: boolean
  readonly descendantIds: readonly string[]
}

/** One keyboard-navigable rail row, top to bottom. */
export type NavRow =
  | (Remote & {
      readonly id: string
      readonly kind: "project"
      readonly repo: string
      readonly label: string
    })
  | (Remote & {
      readonly id: string
      readonly kind: "task"
      readonly task: TaskRow
      /** Indent level: 1 for a top-level task, +1 per generation, held at {@link MAX_ROW_DEPTH}. */
      readonly depth: number
      /** The real generation of a row deeper than the indent cap; absent while the indent still tells. */
      readonly level?: number
      /** Set on a task with children: how many descendants, and whether they are folded away. */
      readonly fold?: RowFold
    })
  /** One row folding a project's routine sessions (`tree-core.ts` `routines`); `key` names the fold in `expandedRoutines`. */
  | (Remote & {
      readonly id: string
      readonly kind: "routines"
      readonly repo: string
      readonly key: string
      readonly tasks: readonly TaskRow[]
      readonly expanded: boolean
    })

/** A parent with more children than this starts folded (the TUI's `AUTO_FOLD_CHILDREN`). */
export const AUTO_FOLD_CHILDREN = 5

/** Which parents are folded: the user's choices over the automatic rule. */
export interface FoldState {
  /** Folded by hand. */
  readonly folded: ReadonlySet<string>
  /** Opened by hand: stays open however many children it has. */
  readonly opened: ReadonlySet<string>
  /** The selected task: an automatic fold never hides it. */
  readonly selectedId?: string
}

const NO_FOLDS: FoldState = { folded: new Set(), opened: new Set() }

const stamp = (iso: string | undefined): number => {
  const parsed = Date.parse(iso ?? "")
  return Number.isFinite(parsed) ? parsed : 0
}
const taskTime = (task: TaskRow): number => stamp(task.updatedAt ?? task.createdAt)
/**
 * The `recent` sort: newest-created first. Not `updatedAt`, which also moves on bookkeeping
 * (a first open, a PR poll) and would reorder rows under a click.
 */
const createdTime = (task: TaskRow): number => stamp(task.createdAt)
const compareNewest = (a: TaskRow, b: TaskRow): number => createdTime(b) - createdTime(a) || b.id.localeCompare(a.id)
// `groups.ts` compareRecent / compareName (not importable here: `@/` paths).
const compareRecent = (a: TaskRow, b: TaskRow): number => taskTime(b) - taskTime(a) || b.id.localeCompare(a.id)
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const compareName = (a: TaskRow, b: TaskRow): number =>
  collator.compare(a.title.trim(), b.title.trim()) || a.id.localeCompare(b.id)
/** `rank` is the bridge's task-group rank (needs a person next first), as `compareTaskGroup`. */
const compareAttention = (a: TaskRow, b: TaskRow): number => a.rank - b.rank || compareRecent(a, b)

const COMPARE: Record<SortMode, ((a: TaskRow, b: TaskRow) => number) | null> = {
  default: null,
  recent: compareNewest,
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

/** Indent stops growing here; a deeper row keeps this depth and shows its real level (TUI `MAX_TREE_DEPTH`). */
export const MAX_ROW_DEPTH = 3

/** `shared` = runs in its parent's directory, `worktree` = its own checkout; null for a task nobody spawned. */
export type ChildMarker = "shared" | "worktree"

export function childMarkerOf(task: TaskRow): ChildMarker | null {
  if (task.parentTaskId === undefined) return null
  return task.sharesWorkspaceOf === undefined ? "worktree" : "shared"
}

/** True when `task`'s parent chain comes back to `task`. */
function loopsBack(task: TaskRow, byId: ReadonlyMap<string, TaskRow>): boolean {
  const seen = new Set<string>([task.id])
  for (let at = task.parentTaskId; at !== undefined; at = byId.get(at)?.parentTaskId) {
    if (seen.has(at)) return at === task.id
    seen.add(at)
  }
  return false
}

/**
 * Children nest under their parent wherever it sits, another project's included. One whose parent is
 * not on screen (or whose lineage loops) stays top level; routine sessions stay in their fold.
 * Children keep list order (`tree-core.ts` `indexChildren`).
 */
function indexChildren(groups: readonly ProjectGroup[]): {
  children: ReadonlyMap<string, readonly TaskRow[]>
  nested: ReadonlySet<string>
} {
  const byId = new Map<string, TaskRow>()
  for (const group of groups) for (const task of group.tasks) byId.set(task.id, task)
  const children = new Map<string, TaskRow[]>()
  const nested = new Set<string>()
  for (const task of byId.values()) {
    const parent = task.parentTaskId
    if (parent === undefined || task.routine || !byId.has(parent) || loopsBack(task, byId)) continue
    nested.add(task.id)
    const siblings = children.get(parent)
    if (siblings) siblings.push(task)
    else children.set(parent, [task])
  }
  return { children, nested }
}

function descendantIds(children: ReadonlyMap<string, readonly TaskRow[]>, id: string, out: string[] = []): string[] {
  for (const child of children.get(id) ?? []) {
    out.push(child.id)
    descendantIds(children, child.id, out)
  }
  return out
}

/** The user's choice wins; otherwise a crowded parent folds, unless the selected task sits under it. */
function isFolded(id: string, childCount: number, descendants: readonly string[], fold: FoldState): boolean {
  if (fold.folded.has(id)) return true
  if (fold.opened.has(id) || childCount <= AUTO_FOLD_CHILDREN) return false
  return fold.selectedId === undefined || !descendants.includes(fold.selectedId)
}

/**
 * Flatten to navigable rows, pruned to `query` like `filterTreeRows`: each field
 * matched on its own; a project hit keeps its whole subtree, a task hit its
 * children, a child hit its parents and project. A folded task (`fold`) hides its children.
 */
export function navRows(
  groups: readonly ProjectGroup[],
  query = "",
  expandedRoutines: ReadonlySet<string> = new Set(),
  fold: FoldState = NO_FOLDS,
): NavRow[] {
  const q = query.trim()
  const hit = (...fields: string[]) => fields.some((f) => f !== "" && fuzzyMatch(q, f))
  const { children, nested } = indexChildren(groups)
  const rows: NavRow[] = []
  for (const group of groups) {
    const projectHit = q === "" || hit(group.label)
    const head: Remote = group.machine === undefined ? {} : { machine: group.machine }
    const key = group.key ?? group.repo
    const selfHit = (task: TaskRow) => projectHit || hit(task.title, task.branch, repoLabel(task.repo))
    // A task survives the filter on its own hit or a descendant's.
    const hasHit = (task: TaskRow): boolean => selfHit(task) || (children.get(task.id) ?? []).some(hasHit)
    // A task, then its children one level deeper each.
    const push = (out: NavRow[], task: TaskRow, generation: number, inherited = false): void => {
      const level = generation + 1
      const remote: Remote = task.machine ? { machine: task.machine.id } : {}
      const kids = children.get(task.id)
      const ids = kids ? descendantIds(children, task.id) : []
      // A search shows everything, so a folded parent stays open under it (the TUI's rule).
      const folded = kids !== undefined && q === "" && isFolded(task.id, kids.length, ids, fold)
      out.push({
        id: task.id,
        kind: "task",
        task,
        depth: Math.min(level, MAX_ROW_DEPTH),
        ...(level > MAX_ROW_DEPTH ? { level } : {}),
        ...(kids ? { fold: { count: ids.length, collapsed: folded, descendantIds: ids } } : {}),
        ...remote,
      })
      const open = inherited || selfHit(task)
      if (folded) return
      for (const child of kids ?? []) if (open || hasHit(child)) push(out, child, generation + 1, open)
    }
    const under: NavRow[] = []
    const routines: TaskRow[] = []
    const routineRows: NavRow[] = []
    for (const task of group.tasks) {
      if (nested.has(task.id) || !hasHit(task)) continue
      // Routine sessions are the tail of the group: a count row folds them.
      if (task.routine) {
        routines.push(task)
        push(routineRows, task, 0)
      } else push(under, task, 0)
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
  readonly query: string
  readonly routines: ReadonlySet<string>
  /** Parents the user folded or opened over the automatic rule; absent = automatic only. */
  readonly fold?: FoldState
}

const newest = (group: ProjectGroup): number => Math.max(0, ...group.tasks.map(createdTime))

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
  const rows = navRows(labelled, input.query, input.routines, input.fold)
  const groups = parts
    .filter((part) => part.machine === undefined)
    .map((part) => {
      const project = projectOf.get(part)
      return { ...part.group, label: (project && labels.get(project)) ?? part.group.label }
    })
  return { rows, groups }
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

export type DropSide = "above" | "below"

/** {@link dragSteps} for a drop that lands right above or right below `to`. */
export function dropSteps(tasks: readonly TaskRow[], from: TaskRow, to: TaskRow, side: DropSide): number | null {
  const steps = dragSteps(tasks, from, to)
  if (steps === null) return null
  if (side === "above" && steps > 0) return steps - 1
  if (side === "below" && steps < 0) return steps + 1
  return steps
}

/** A row's nesting level: a project 0, its tasks and routine count 1, a child task one deeper per generation. */
const depthOf = (row: NavRow | undefined): number =>
  row === undefined || row.kind === "project" ? 0 : row.kind === "task" ? row.depth : 1

/** Where the block starting at `i` (the row and every row nested under it) ends. */
export function blockEnd(rows: readonly NavRow[], i: number): number {
  const depth = depthOf(rows[i])
  let end = i + 1
  while (end < rows.length && depthOf(rows[end]) > depth) end++
  return end
}

/** `rows` with the dragged row's block moved right above or below the target's block, as it would land. */
export function previewDrop(rows: readonly NavRow[], fromId: string, toId: string, side: DropSide): readonly NavRow[] {
  const from = rows.findIndex((row) => row.id === fromId)
  if (from < 0 || fromId === toId) return rows
  const end = blockEnd(rows, from)
  const block = rows.slice(from, end)
  const rest = [...rows.slice(0, from), ...rows.slice(end)]
  const to = rest.findIndex((row) => row.id === toId)
  if (to < 0) return rows
  const at = side === "above" ? to : blockEnd(rest, to)
  return [...rest.slice(0, at), ...block, ...rest.slice(at)]
}

/**
 * A task row names its conversation like the TUI's (`conversationTitleOf`): the first engine tab the
 * engine has named, else the task's own title. A bare product name is no name, so it falls through.
 */
export function rowTitle(task: TaskRow, tabs: readonly TabRow[] | undefined): string {
  if (task.kind !== "task") return task.title
  return tabs?.find((tab) => tab.kind === "engine" && tab.conversation)?.conversation ?? task.title
}
