/**
 * Reads a side panel back from localStorage. Three shapes arrive: the columns this writes, the tab
 * groups (`top` / `bottom`) it wrote before, and the two keys before those (`panelTab`, `panelUrl`).
 * Anything unreadable is dropped, so the task falls back to a fresh panel.
 */

import { blankBrowser, openUrl, parseBrowser } from "./browser-tabs.ts"
import type { PanelKind } from "./panel-model.ts"
import { type Column, type DiffScope, type TaskPanel, inKindOrder, newPanel } from "./panel-model.ts"

export const REMEMBERED_TASKS = 50

const KINDS: readonly string[] = ["files", "chat", "diff", "browser", "quota"] satisfies readonly PanelKind[]

const scopeOf = (raw: unknown): DiffScope => (raw === "branch" || raw === "task" ? raw : "working")

function parseColumn(raw: unknown): Column | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (r.kind === "files" || r.kind === "chat" || r.kind === "quota") return { kind: r.kind }
  if (r.kind === "diff" && typeof r.path === "string" && r.path !== "") {
    return { kind: "diff", path: r.path, scope: scopeOf(r.scope) }
  }
  return r.kind === "browser" ? parseBrowser(r.tabs, r.active, r.recent, r.next) : null
}

function parseWeights(raw: unknown, columns: readonly Column[]): TaskPanel["weights"] {
  if (!raw || typeof raw !== "object") return {}
  const r = raw as Record<string, unknown>
  const entries = columns.flatMap(({ kind }) => {
    const w = r[kind]
    return typeof w === "number" && Number.isFinite(w) && w > 0 ? [[kind, w] as const] : []
  })
  return Object.fromEntries(entries)
}

/** The tab groups' tabs, in group order (top, then bottom), with the order they were shown in. */
function oldTabs(r: Record<string, unknown>): { tabs: Record<string, unknown>[]; recent: string[] } | null {
  const groups = [r.top, r.bottom].map((group) =>
    group && typeof group === "object" && "tabs" in group && Array.isArray(group.tabs) ? group.tabs : null,
  )
  if (!groups[0]) return null
  const tabs = groups
    .flatMap((group) => group ?? [])
    .filter((tab): tab is Record<string, unknown> => !!tab && typeof tab === "object" && /^t\d+$/.test(String(tab.id)))
  const recent = Array.isArray(r.recent) ? r.recent.filter((id): id is string => typeof id === "string") : []
  return { tabs, recent }
}

/**
 * Tab groups into columns: each kind that had a tab becomes a column, in its fixed place; the Diff
 * column keeps the diff shown last, the Browser all its tabs.
 */
function fromGroups(r: Record<string, unknown>): TaskPanel | null {
  const old = oldTabs(r)
  if (!old) return null
  const kinds = [...new Set(old.tabs.map((tab) => tab.kind))]
  const columns: Column[] = []
  for (const kind of kinds) {
    if (kind === "files" || kind === "chat" || kind === "quota") columns.push({ kind })
    if (kind === "diff") {
      const diffs = old.tabs.filter((tab) => tab.kind === "diff" && typeof tab.path === "string" && tab.path !== "")
      const shown = [...old.recent].reverse().map((id) => diffs.find((tab) => tab.id === id))
      const last = shown.find((tab) => tab) ?? diffs[0]
      if (last) columns.push({ kind: "diff", path: last.path as string, scope: scopeOf(last.scope) })
    }
    if (kind === "browser") {
      const browser = parseBrowser(
        old.tabs.filter((tab) => tab.kind === "browser"),
        undefined,
        old.recent,
        r.next,
      )
      if (browser) columns.push(browser)
    }
  }
  return { columns: inKindOrder(columns), weights: {} }
}

/** A stored panel back into shape; null when nothing usable is in it. */
export function parsePanel(raw: unknown): TaskPanel | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.columns)) return fromGroups(r)
  const columns: Column[] = []
  for (const entry of r.columns) {
    const col = parseColumn(entry)
    if (col && !columns.some((c) => c.kind === col.kind)) columns.push(col)
  }
  return { columns: inKindOrder(columns), weights: parseWeights(r.weights, columns) }
}

/** What the panel kept before it had tabs: the view it was on (a diff's file was never kept) and the Browser's last address. */
function fromLegacy(view: unknown, url: unknown): TaskPanel {
  const files = newPanel()
  const address = typeof url === "string" && url !== "" ? url : ""
  if (view !== "browser" && !address) return files
  return { ...files, columns: [...files.columns, address ? openUrl(blankBrowser(), address) : blankBrowser()] }
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
