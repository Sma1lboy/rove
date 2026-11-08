/**
 * The side panel's Browser column as plain data: the one column that has tabs. Every function returns
 * the next column (or null when the last tab closed) and leaves the one it was given alone.
 */

export interface BrowserTab {
  readonly id: string
  readonly urls: readonly string[]
  /** Index into `urls` of the address shown; -1 while blank. */
  readonly at: number
}

export interface BrowserColumn {
  readonly kind: "browser"
  readonly tabs: readonly BrowserTab[]
  readonly active: string
  /** Tab ids, most recently shown last. */
  readonly recent: readonly string[]
  /** The number the next tab id is made from. */
  readonly next: number
}

export const MAX_TABS = 12
/** Tabs with a live frame at once; the rest keep their address and history and reload when shown. */
export const MAX_FRAMES = 3
export const BROWSER_HISTORY = 30

/** The address a tab is on ("" = none yet). */
export function browserUrl(tab: BrowserTab): string {
  return tab.urls[tab.at] ?? ""
}

export function browserHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** A column with one blank tab. */
export function blankBrowser(): BrowserColumn {
  return { kind: "browser", tabs: [{ id: "t1", urls: [], at: -1 }], active: "t1", recent: ["t1"], next: 2 }
}

export function activateTab(col: BrowserColumn, id: string): BrowserColumn {
  if (!col.tabs.some((tab) => tab.id === id)) return col
  if (col.active === id && col.recent.at(-1) === id) return col
  return { ...col, active: id, recent: [...col.recent.filter((r) => r !== id), id] }
}

/** Past `MAX_TABS` the least recently shown tab that is not on screen closes. */
function trim(col: BrowserColumn): BrowserColumn {
  let next = col
  while (next.tabs.length > MAX_TABS) {
    const victim = next.tabs
      .filter((tab) => tab.id !== next.active)
      .sort((a, b) => next.recent.indexOf(a.id) - next.recent.indexOf(b.id))[0]
    if (!victim) break
    next = dropTab(next, victim.id) ?? next
  }
  return next
}

function addTab(col: BrowserColumn, urls: readonly string[]): BrowserColumn {
  const id = `t${col.next}`
  const tab: BrowserTab = { id, urls, at: urls.length - 1 }
  return trim(activateTab({ ...col, tabs: [...col.tabs, tab], next: col.next + 1 }, id))
}

/** A new blank tab, shown. */
export function newTab(col: BrowserColumn): BrowserColumn {
  return addTab(col, [])
}

function replaceTab(col: BrowserColumn, tab: BrowserTab): BrowserColumn {
  return { ...col, tabs: col.tabs.map((t) => (t.id === tab.id ? tab : t)) }
}

/** Typing or following an address in a tab: forward history is dropped, the oldest entries age out. */
export function navigate(col: BrowserColumn, id: string, url: string): BrowserColumn {
  const hit = col.tabs.find((tab) => tab.id === id)
  if (!hit || browserUrl(hit) === url) return col
  const urls = [...hit.urls.slice(0, hit.at + 1), url].slice(-BROWSER_HISTORY)
  return replaceTab(col, { ...hit, urls, at: urls.length - 1 })
}

/** Back / forward inside a tab's own history. */
export function stepTab(col: BrowserColumn, id: string, at: number): BrowserColumn {
  const hit = col.tabs.find((tab) => tab.id === id)
  if (!hit || at === hit.at || at < 0 || at >= hit.urls.length) return col
  return replaceTab(col, { ...hit, at })
}

/** An address: the tab already on it, else a blank tab, else a new one. */
export function openUrl(col: BrowserColumn, url: string): BrowserColumn {
  const same = col.tabs.find((tab) => browserUrl(tab) === url)
  if (same) return activateTab(col, same.id)
  const blank = col.tabs.find((tab) => browserUrl(tab) === "")
  if (blank) return navigate(activateTab(col, blank.id), blank.id, url)
  return addTab(col, [url])
}

function dropTab(col: BrowserColumn, id: string): BrowserColumn | null {
  const tabs = col.tabs.filter((tab) => tab.id !== id)
  if (tabs.length === 0) return null
  const recent = col.recent.filter((r) => r !== id)
  if (col.active !== id) return { ...col, tabs, recent }
  const active = [...recent].reverse().find((r) => tabs.some((tab) => tab.id === r)) ?? (tabs[0] as BrowserTab).id
  return { ...col, tabs, active, recent: [...recent.filter((r) => r !== active), active] }
}

/** Null when it was the last tab: the column closes with it. */
export function closeTab(col: BrowserColumn, id: string): BrowserColumn | null {
  return col.tabs.some((tab) => tab.id === id) ? dropTab(col, id) : col
}

export function closeOtherTabs(col: BrowserColumn, id: string): BrowserColumn {
  const keep = col.tabs.find((tab) => tab.id === id)
  if (!keep) return col
  return { ...col, tabs: [keep], active: id, recent: [id] }
}

/**
 * The tabs to keep mounted: `prev` plus the shown one, dropping tabs that are gone and, past
 * `MAX_FRAMES`, the least recently shown. The shown tab is never dropped.
 */
export function mountedTabs(prev: readonly string[], active: string, tabs: readonly BrowserTab[]): string[] {
  const live = new Set(tabs.map((tab) => tab.id))
  const next = [...prev.filter((id) => live.has(id) && id !== active), ...(live.has(active) ? [active] : [])]
  return next.slice(Math.max(0, next.length - MAX_FRAMES))
}

/** A stored tab list back into shape: keep what is well-formed, drop the rest; null when no tab survives. */
export function parseBrowser(rawTabs: unknown, active: unknown, recent: unknown, next: unknown): BrowserColumn | null {
  if (!Array.isArray(rawTabs)) return null
  const tabs: BrowserTab[] = []
  for (const raw of rawTabs) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    if (typeof r.id !== "string" || !/^t\d+$/.test(r.id) || tabs.some((tab) => tab.id === r.id)) continue
    const urls = Array.isArray(r.urls)
      ? r.urls.filter((u): u is string => typeof u === "string" && u !== "").slice(-BROWSER_HISTORY)
      : []
    const at = typeof r.at === "number" && Number.isInteger(r.at) ? r.at : urls.length - 1
    tabs.push({ id: r.id, urls, at: urls.length === 0 ? -1 : Math.min(urls.length - 1, Math.max(0, at)) })
  }
  const first = tabs[0]
  if (!first) return null
  const ids = new Set(tabs.map((tab) => tab.id))
  const seen = Array.isArray(recent) ? recent.filter((id): id is string => typeof id === "string" && ids.has(id)) : []
  const shown = typeof active === "string" && ids.has(active) ? active : (seen.at(-1) ?? first.id)
  const highest = Math.max(...tabs.map((tab) => Number(tab.id.slice(1))))
  return {
    kind: "browser",
    tabs,
    active: shown,
    recent: [...seen.filter((id) => id !== shown), shown],
    next: Math.max(highest + 1, typeof next === "number" && Number.isInteger(next) ? next : 0),
  }
}
