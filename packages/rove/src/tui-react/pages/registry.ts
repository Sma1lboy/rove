/**
 * Every page the content pane can show, whoever contributed it: the host's own
 * (`source: "core"`), a plugin shipped inside Rove, or an installed plugin's
 * `[[pages]]`. The rail, the content pane and the page-open chords all read
 * this one list, so a page is either fully present or absent.
 */

import type { ReactNode } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import type { TaskEngineState } from "../../client/remote-orchestrator-payloads"
import { createStateCell } from "../../lib/external-store"
import type { PageAction } from "../../tui/panes/sidebar/nav-core"
import type { Task } from "../../types/task"
import { useAccessor } from "../lib/use-accessor"

/** What the host hands every page. */
export interface PageProps {
  readonly orchestrator: RemoteOrchestrator
  /** The content pane has focus; gate bare keys on it. */
  readonly focused: boolean
  readonly onClose: () => void
  /** Leave the page and enter a task, on `tabId` when given (a tab that is gone is ignored). */
  readonly onOpenTask: (taskId: string, tabId?: string) => void
  /** The sidebar's selected task, so a page can open on its project. */
  readonly selectedTask: Task | undefined
  readonly engineStates: ReadonlyMap<string, TaskEngineState>
}

export type PageComponent = (props: PageProps) => ReactNode

export interface PageEntry {
  /** Rail id: a bare word for core pages, `<plugin>.<page>` for plugin pages. */
  readonly id: string
  /** Read at render, so the label follows the UI language. */
  readonly title: () => string
  /** Rail position, ascending. */
  readonly order: number
  readonly action?: PageAction
  readonly component: PageComponent
  /** Absent for core pages. */
  readonly pluginId?: string
}

/** Contributions by source key (`core`, a plugin id), replaced whole on reload. */
const sources = createStateCell<ReadonlyMap<string, readonly PageEntry[]>>(new Map(), "pages")

/** Replace everything `source` contributes; an empty list removes it. */
export function setPageSource(source: string, entries: readonly PageEntry[]): void {
  sources.update((current) => {
    const next = new Map(current)
    if (entries.length === 0) next.delete(source)
    else next.set(source, entries)
    return next
  })
}

/**
 * Replace every source under `prefix` at once (`plugin:` after a reload), so a
 * plugin disabled since the last load leaves the rail in the same update.
 */
export function replacePageSources(prefix: string, next: ReadonlyMap<string, readonly PageEntry[]>): void {
  sources.update((current) => {
    const merged = new Map([...current].filter(([key]) => !key.startsWith(prefix)))
    for (const [key, entries] of next) if (entries.length > 0) merged.set(`${prefix}${key}`, entries)
    return merged
  })
}

function sortedEntries(map: ReadonlyMap<string, readonly PageEntry[]>): PageEntry[] {
  return [...map.values()].flat().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

let lastMap: ReadonlyMap<string, readonly PageEntry[]> | null = null
let lastSorted: readonly PageEntry[] = []

/**
 * Rail order. A second page claiming an action already taken (lower order
 * wins) keeps its rail row but loses the chord.
 */
export function pageEntries(): readonly PageEntry[] {
  const map = sources.get()
  if (map === lastMap) return lastSorted
  const claimed = new Set<string>()
  lastSorted = sortedEntries(map).map((entry) => {
    if (!entry.action) return entry
    if (claimed.has(entry.action)) {
      const { action: _taken, ...rest } = entry
      return rest
    }
    claimed.add(entry.action)
    return entry
  })
  lastMap = map
  return lastSorted
}

export function usePageEntries(): readonly PageEntry[] {
  useAccessor(sources)
  return pageEntries()
}
