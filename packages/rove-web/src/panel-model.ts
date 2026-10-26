/**
 * A task's side panel as plain data: an ordered list of tabs (each a view of one kind with its own
 * state) in one group, or two stacked ones (top / bottom), plus the split ratio. Every function
 * returns the next panel and leaves the one it was given alone; `panel-state.ts` stores them and
 * `side-panel.tsx` draws them.
 */

import type { PanelKind } from "./panel-layout.ts"

export type GroupName = "top" | "bottom"
export type DiffScope = "working" | "branch"

export type PanelItem =
  | { readonly id: string; readonly kind: "files" }
  | { readonly id: string; readonly kind: "diff"; readonly path: string; readonly scope: DiffScope }
  | { readonly id: string; readonly kind: "browser"; readonly urls: readonly string[]; readonly at: number }

export interface PanelGroup {
  readonly tabs: readonly PanelItem[]
  readonly active: string | null
}

export interface TaskPanel {
  readonly top: PanelGroup
  /** Present only while split; closing its last tab removes it. */
  readonly bottom: PanelGroup | null
  /** The top group's share of the height. */
  readonly ratio: number
  /** The group last touched: where a new tab of a kind not yet open lands. */
  readonly focus: GroupName
  /** Tab ids, most recently shown last. */
  readonly recent: readonly string[]
  /** The number the next tab id is made from. */
  readonly next: number
}

export const MAX_TABS = 12
/** Browser tabs with a live frame at once; the rest keep their address and history and reload when shown. */
export const MAX_FRAMES = 3
export const BROWSER_HISTORY = 30
export const MIN_RATIO = 0.2
export const REMEMBERED_TASKS = 50

const KINDS: readonly string[] = ["files", "diff", "browser"] satisfies readonly PanelKind[]

export function newPanel(): TaskPanel {
  return {
    top: { tabs: [{ id: "t1", kind: "files" }], active: "t1" },
    bottom: null,
    ratio: 0.5,
    focus: "top",
    recent: ["t1"],
    next: 2,
  }
}

export function groupsOf(panel: TaskPanel): readonly (readonly [GroupName, PanelGroup])[] {
  return panel.bottom
    ? [
        ["top", panel.top],
        ["bottom", panel.bottom],
      ]
    : [["top", panel.top]]
}

/** Creation order: views render in this order whatever the tab order, so reordering never moves a frame in the DOM. */
export function allTabs(panel: TaskPanel): PanelItem[] {
  const number = (tab: PanelItem) => Number(tab.id.slice(1))
  return groupsOf(panel)
    .flatMap(([, group]) => group.tabs)
    .sort((a, b) => number(a) - number(b))
}

export function findTab(panel: TaskPanel, id: string): { tab: PanelItem; name: GroupName; group: PanelGroup } | null {
  for (const [name, group] of groupsOf(panel)) {
    const tab = group.tabs.find((candidate) => candidate.id === id)
    if (tab) return { tab, name, group }
  }
  return null
}

/** The tab of a kind shown most recently (else the first), or null. */
export function latestOfKind(panel: TaskPanel, kind: PanelKind): PanelItem | null {
  const tabs = allTabs(panel).filter((tab) => tab.kind === kind)
  for (const id of [...panel.recent].reverse()) {
    const hit = tabs.find((tab) => tab.id === id)
    if (hit) return hit
  }
  return tabs[0] ?? null
}

/** The address a Browser tab is on ("" = none yet). */
export function browserUrl(tab: Extract<PanelItem, { kind: "browser" }>): string {
  return tab.urls[tab.at] ?? ""
}

export function diffName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

export function browserHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** The group a new tab of this kind joins: where one already is, else the group last used. */
function homeGroup(panel: TaskPanel, kind: PanelKind): GroupName {
  for (const [name, group] of groupsOf(panel)) if (group.tabs.some((tab) => tab.kind === kind)) return name
  return panel.bottom ? panel.focus : "top"
}

function pick(group: PanelGroup, recent: readonly string[], gone?: string): string | null {
  const ids = group.tabs.filter((tab) => tab.id !== gone).map((tab) => tab.id)
  for (const id of [...recent].reverse()) if (ids.includes(id)) return id
  return ids[0] ?? null
}

/** Repairs what an edit can leave behind: an empty bottom group, a group without a valid active tab, stale recents. */
function settle(panel: TaskPanel): TaskPanel {
  let { top, bottom } = panel
  if (bottom && bottom.tabs.length === 0) bottom = null
  if (top.tabs.length === 0 && bottom) [top, bottom] = [bottom, null]
  const ids = new Set([...top.tabs, ...(bottom?.tabs ?? [])].map((tab) => tab.id))
  const recent = panel.recent.filter((id) => ids.has(id))
  const mend = (group: PanelGroup): PanelGroup =>
    group.active && group.tabs.some((tab) => tab.id === group.active)
      ? group
      : { ...group, active: pick(group, recent) }
  return { ...panel, top: mend(top), bottom: bottom && mend(bottom), recent, focus: bottom ? panel.focus : "top" }
}

function setGroup(panel: TaskPanel, name: GroupName, group: PanelGroup): TaskPanel {
  return name === "top" ? { ...panel, top: group } : { ...panel, bottom: group }
}

export function activate(panel: TaskPanel, id: string): TaskPanel {
  const hit = findTab(panel, id)
  if (!hit) return panel
  const { group, name } = hit
  const recent = [...panel.recent.filter((r) => r !== id), id]
  if (group.active === id && panel.focus === name && panel.recent.at(-1) === id) return panel
  return { ...setGroup(panel, name, { ...group, active: id }), focus: name, recent }
}

/** Past `MAX_TABS` the least recently shown tab that is not on screen closes. */
function trim(panel: TaskPanel): TaskPanel {
  const tabs = allTabs(panel)
  if (tabs.length <= MAX_TABS) return panel
  const shown = new Set(groupsOf(panel).map(([, group]) => group.active))
  const victim = tabs
    .filter((tab) => !shown.has(tab.id))
    .sort((a, b) => panel.recent.indexOf(a.id) - panel.recent.indexOf(b.id))[0]
  return victim ? closeTab(panel, victim.id) : panel
}

function addTab(panel: TaskPanel, to: GroupName, make: (id: string) => PanelItem): TaskPanel {
  const id = `t${panel.next}`
  const name = to === "bottom" && panel.bottom ? "bottom" : "top"
  const group = name === "bottom" && panel.bottom ? panel.bottom : panel.top
  const grown = setGroup({ ...panel, next: panel.next + 1 }, name, { ...group, tabs: [...group.tabs, make(id)] })
  return trim(activate(grown, id))
}

const blankBrowser = (id: string): PanelItem => ({ id, kind: "browser", urls: [], at: -1 })

/** Always a new Files tab (the + menu); `showKind` is the one that reuses. */
export function newFiles(panel: TaskPanel, to: GroupName): TaskPanel {
  return addTab(panel, to, (id) => ({ id, kind: "files" }))
}

export function newBrowser(panel: TaskPanel, to: GroupName): TaskPanel {
  return addTab(panel, to, blankBrowser)
}

/** A file's diff (`.` = the whole worktree): its tab if it has one, else a new one beside the other diffs. */
export function showDiff(panel: TaskPanel, path: string, scope: DiffScope): TaskPanel {
  const hit = allTabs(panel).find((tab) => tab.kind === "diff" && tab.path === path)
  if (!hit) return addTab(panel, homeGroup(panel, "diff"), (id) => ({ id, kind: "diff", path, scope }))
  if (hit.kind === "diff" && hit.scope !== scope) return activate(replaceTab(panel, { ...hit, scope }), hit.id)
  return activate(panel, hit.id)
}

/** An address: the tab already on it, else a blank Browser tab, else a new one. */
export function showBrowser(panel: TaskPanel, url: string): TaskPanel {
  const browsers = allTabs(panel).filter((tab) => tab.kind === "browser")
  const same = browsers.find((tab) => browserUrl(tab) === url)
  if (same) return activate(panel, same.id)
  const blank = browsers.find((tab) => browserUrl(tab) === "")
  if (blank) return navigate(panel, blank.id, url)
  return navigate(addTab(panel, homeGroup(panel, "browser"), blankBrowser), `t${panel.next}`, url)
}

/** A view by kind alone (`--view files`, the phone's switch): the one shown last, else a new one. */
export function showKind(panel: TaskPanel, kind: PanelKind): TaskPanel {
  const hit = latestOfKind(panel, kind)
  if (hit) return activate(panel, hit.id)
  if (kind === "diff") return showDiff(panel, ".", "working")
  return addTab(panel, homeGroup(panel, kind), (id) => (kind === "files" ? { id, kind } : blankBrowser(id)))
}

function replaceTab(panel: TaskPanel, tab: PanelItem): TaskPanel {
  const swap = (group: PanelGroup): PanelGroup => ({
    ...group,
    tabs: group.tabs.map((t) => (t.id === tab.id ? tab : t)),
  })
  return { ...panel, top: swap(panel.top), bottom: panel.bottom && swap(panel.bottom) }
}

/** Typing or following an address in a Browser tab: forward history is dropped, the oldest entries age out. */
export function navigate(panel: TaskPanel, id: string, url: string): TaskPanel {
  const hit = findTab(panel, id)?.tab
  if (hit?.kind !== "browser" || browserUrl(hit) === url) return panel
  const urls = [...hit.urls.slice(0, hit.at + 1), url].slice(-BROWSER_HISTORY)
  return replaceTab(panel, { ...hit, urls, at: urls.length - 1 })
}

/** Back / forward inside a Browser tab's own history. */
export function stepBrowser(panel: TaskPanel, id: string, at: number): TaskPanel {
  const hit = findTab(panel, id)?.tab
  if (hit?.kind !== "browser" || at === hit.at || at < 0 || at >= hit.urls.length) return panel
  return replaceTab(panel, { ...hit, at })
}

/** Closing a group's last tab collapses the split. */
export function closeTab(panel: TaskPanel, id: string): TaskPanel {
  const hit = findTab(panel, id)
  if (!hit) return panel
  const { group } = hit
  const tabs = group.tabs.filter((tab) => tab.id !== id)
  const recent = panel.recent.filter((r) => r !== id)
  const active = group.active === id ? pick(group, recent, id) : group.active
  return settle({ ...setGroup(panel, hit.name, { tabs, active }), recent })
}

export function closeOthers(panel: TaskPanel, id: string): TaskPanel {
  return allTabs(panel).reduce((next, tab) => (tab.id === id ? next : closeTab(next, tab.id)), panel)
}

/**
 * Moves a tab to a group, before `index` of that group's tabs (end when omitted). Moving into
 * "bottom" while unsplit splits; moving out the last tab of a group collapses.
 */
export function moveTab(panel: TaskPanel, id: string, to: GroupName, index?: number): TaskPanel {
  const hit = findTab(panel, id)
  if (!hit) return panel
  const from = hit.group
  const without = from.tabs.filter((tab) => tab.id !== id)
  const origin = from.tabs.findIndex((tab) => tab.id === id)
  if (hit.name === to) {
    const at = Math.max(
      0,
      Math.min(without.length, (index ?? without.length) - (index !== undefined && index > origin ? 1 : 0)),
    )
    if (at === origin) return activate(panel, id)
    return activate(
      setGroup(panel, to, { ...from, tabs: [...without.slice(0, at), hit.tab, ...without.slice(at)] }),
      id,
    )
  }
  const recent = panel.recent.filter((r) => r !== id)
  const left = setGroup(panel, hit.name, {
    tabs: without,
    active: from.active === id ? pick(from, recent, id) : from.active,
  })
  const target = to === "top" ? left.top : left.bottom
  const tabs = target?.tabs ?? []
  const at = Math.max(0, Math.min(tabs.length, index ?? tabs.length))
  const placed = setGroup({ ...left, recent }, to, {
    tabs: [...tabs.slice(0, at), hit.tab, ...tabs.slice(at)],
    active: id,
  })
  return activate(settle(placed), id)
}

export function setRatio(panel: TaskPanel, ratio: number): TaskPanel {
  const next = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, ratio))
  return Math.abs(next - panel.ratio) < 0.001 ? panel : { ...panel, ratio: next }
}

/**
 * The tabs to keep mounted: `prev` plus the tabs on screen, dropping tabs that are gone and, past
 * `MAX_FRAMES`, the least recently shown Browser tabs that are not on screen.
 */
export function mountedTabs(prev: readonly string[], visible: readonly string[], tabs: readonly PanelItem[]): string[] {
  const kinds = new Map(tabs.map((tab) => [tab.id, tab.kind]))
  let next = [...prev.filter((id) => kinds.has(id) && !visible.includes(id)), ...visible.filter((id) => kinds.has(id))]
  const frames = next.filter((id) => kinds.get(id) === "browser")
  const evict = new Set(frames.slice(0, Math.max(0, frames.length - MAX_FRAMES)).filter((id) => !visible.includes(id)))
  next = next.filter((id) => !evict.has(id))
  return next
}

/** A new tab's browser state or the like arrives from storage: keep what is well-formed, drop the rest. */
function parseItem(raw: unknown): PanelItem | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== "string" || !/^t\d+$/.test(r.id)) return null
  if (r.kind === "files") return { id: r.id, kind: "files" }
  if (r.kind === "diff" && typeof r.path === "string" && r.path !== "") {
    return { id: r.id, kind: "diff", path: r.path, scope: r.scope === "branch" ? "branch" : "working" }
  }
  if (r.kind === "browser" && Array.isArray(r.urls)) {
    const urls = r.urls.filter((u): u is string => typeof u === "string" && u !== "").slice(-BROWSER_HISTORY)
    const at =
      typeof r.at === "number" && Number.isInteger(r.at)
        ? Math.min(urls.length - 1, Math.max(-1, r.at))
        : urls.length - 1
    return { id: r.id, kind: "browser", urls, at: urls.length === 0 ? -1 : Math.max(0, at) }
  }
  return null
}

function parseGroup(raw: unknown, seen: Set<string>): PanelGroup | null {
  if (!raw || typeof raw !== "object" || !("tabs" in raw) || !Array.isArray(raw.tabs)) return null
  const tabs: PanelItem[] = []
  for (const entry of raw.tabs) {
    const tab = parseItem(entry)
    if (!tab || seen.has(tab.id)) continue
    seen.add(tab.id)
    tabs.push(tab)
  }
  const active = "active" in raw && typeof raw.active === "string" ? raw.active : null
  return { tabs, active }
}

/** A stored panel back into shape; null when nothing usable is in it. */
export function parsePanel(raw: unknown): TaskPanel | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const seen = new Set<string>()
  const top = parseGroup(r.top, seen)
  if (!top) return null
  const bottom = parseGroup(r.bottom, seen)
  const highest = Math.max(0, ...[...seen].map((id) => Number(id.slice(1))))
  const ratio = typeof r.ratio === "number" && Number.isFinite(r.ratio) ? r.ratio : 0.5
  return settle({
    top,
    bottom,
    ratio: Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, ratio)),
    focus: r.focus === "bottom" ? "bottom" : "top",
    recent: Array.isArray(r.recent) ? r.recent.filter((id): id is string => typeof id === "string") : [],
    next: Math.max(highest + 1, typeof r.next === "number" && Number.isInteger(r.next) ? r.next : 0),
  })
}

/** What the panel used to remember per task: the view it was on (a diff's file was never kept) and the Browser's last address. */
function fromLegacy(view: unknown, url: unknown): TaskPanel {
  const files = newPanel()
  const address = typeof url === "string" && url !== "" ? url : ""
  if (view !== "browser" && !address) return files
  const browser = newBrowser(files, "top")
  const withUrl = address ? navigate(browser, "t2", address) : browser
  return view === "browser" ? withUrl : activate(withUrl, "t1")
}

function entriesOf(raw: string | null): [string, unknown][] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}")
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.entries(parsed) : []
  } catch {
    return []
  }
}

/** The newest `REMEMBERED_TASKS` tasks, the one written last at the end. */
export function remember(
  panels: Readonly<Record<string, TaskPanel>>,
  taskId: string,
  panel: TaskPanel,
): Record<string, TaskPanel> {
  const next = Object.fromEntries(Object.entries(panels).filter(([id]) => id !== taskId))
  next[taskId] = panel
  for (const id of Object.keys(next).slice(0, -REMEMBERED_TASKS)) delete next[id]
  return next
}

/**
 * Every task's panel from storage. `legacy` is what the two keys this replaced held (`panelTab`,
 * `panelUrl`); those tasks join, older than the ones already here, and the caller then drops the keys.
 */
export function loadPanels(
  stored: string | null,
  legacy: { tab: string | null; url: string | null },
): Record<string, TaskPanel> {
  let panels: Record<string, TaskPanel> = {}
  for (const [id, raw] of entriesOf(stored)) {
    const panel = parsePanel(raw)
    if (panel) panels[id] = panel
  }
  const views = new Map(entriesOf(legacy.tab).filter(([, v]) => KINDS.includes(v as string)))
  const urls = new Map(entriesOf(legacy.url))
  const old = [...new Set([...views.keys(), ...urls.keys()])].filter((id) => !(id in panels))
  const migrated = Object.fromEntries(old.map((id) => [id, fromLegacy(views.get(id), urls.get(id))]))
  panels = { ...migrated, ...panels }
  for (const id of Object.keys(panels).slice(0, -REMEMBERED_TASKS)) delete panels[id]
  return panels
}
