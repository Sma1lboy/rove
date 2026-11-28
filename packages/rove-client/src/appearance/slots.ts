/**
 * Shared appearance-pack slot contract for Rove clients (web now; TUI later).
 * Browser-safe: no Node/filesystem imports live here.
 */

export const DEFAULT_APPEARANCE_PACK = "default"
export const APPEARANCE_PACK_STATE_KEY = "appearance.pack"

export function normalizeAppearancePack(raw: unknown): string {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : DEFAULT_APPEARANCE_PACK
}

/**
 * Canonical chrome slots an appearance pack may customize.
 * Every slot has a stable id, a closed set of declarative field names, and a
 * typed data contract handed to custom components.
 */
export const APPEARANCE_SLOTS = [
  "shell.frame",
  "rail.frame",
  "rail.groupHeader",
  "rail.row",
  "rail.footer",
  "session.header",
  "panel.tabs",
  "panel.section",
  "status.bar",
] as const

export type AppearanceSlotId = (typeof APPEARANCE_SLOTS)[number]

/** Declarative field names allowed in `fields`, `secondaryFields`, and `{{field}}` templates per slot. */
export const SLOT_FIELDS: Readonly<Record<AppearanceSlotId, readonly string[]>> = {
  "shell.frame": ["taskCount", "selectedTitle", "panelOpen", "railFolded"],
  "rail.frame": ["unreadCount", "taskCount", "groupBy", "sortBy"],
  "rail.groupHeader": ["label", "repo", "count", "collapsed", "kind"],
  "rail.row": [
    "title",
    "branch",
    "repo",
    "engine",
    "status",
    "statusLabel",
    "pr",
    "todos",
    "tokens",
    "age",
    "cloud",
    "pinned",
    "diffStats",
    "cost",
  ],
  "rail.footer": ["usageSummary", "settingsLabel", "unreadCount"],
  "session.header": ["title", "branch", "repo", "engine", "status", "tabCount", "activeTab"],
  "panel.tabs": ["kind", "title", "hint", "tabCount", "expanded"],
  "panel.section": ["kind", "title", "branch", "repo", "engine", "status", "diffStats", "todos", "pr", "cost"],
  "status.bar": ["connection", "taskTitle", "branch", "engine", "status", "diffStats", "usageSummary"],
}

export interface SlotPrInfo {
  readonly number: number
  readonly state: string
  readonly url?: string
}

export interface SlotDiffStats {
  readonly files: number
  readonly added: number
  readonly removed: number
}

export interface SlotUsageReading {
  readonly label: string
  readonly pct: number | null
  readonly tone: "ok" | "warn" | "crit"
  readonly detail?: string
}

export interface ShellFrameSlotData {
  readonly taskCount: number
  readonly selectedTitle: string
  readonly panelOpen: boolean
  readonly railFolded: boolean
  readonly narrow: boolean
}

export interface RailFrameSlotData {
  readonly unreadCount: number
  readonly taskCount: number
  readonly groupBy: string
  readonly sortBy: string
  readonly folded: boolean
  readonly narrow: boolean
}

export interface RailGroupHeaderSlotData {
  readonly id: string
  readonly kind: "project" | "state"
  readonly label: string
  readonly repo?: string
  readonly count: number
  readonly collapsed: boolean
  readonly onToggle: () => void
  readonly onNewTask?: () => void
}

export interface RailRowSlotData {
  readonly id: string
  readonly title: string
  readonly branch?: string
  readonly repo?: string
  readonly engineId?: string
  readonly engineName?: string
  readonly engineColor?: string
  readonly statusKind: string
  readonly statusLabel: string
  readonly selected: boolean
  readonly cursor: boolean
  readonly stale: boolean
  readonly pinned: boolean
  readonly depth: number
  readonly pr?: SlotPrInfo
  readonly todos?: { readonly done: number; readonly total: number }
  readonly tokens?: readonly { readonly key: string; readonly text: string }[]
  readonly age?: string
  readonly cloud?: string | null
  readonly diffStats?: SlotDiffStats
  readonly cost?: string
  readonly onSelect: () => void
}

export interface RailFooterSlotData {
  readonly unreadCount: number
  readonly settingsLabel: string
  readonly usage: readonly SlotUsageReading[]
  readonly usageSummary: string
  readonly onOpenSettings: () => void
  readonly onOpenInbox: () => void
}

export interface SessionHeaderSlotData {
  readonly taskId: string
  readonly title: string
  readonly branch?: string
  readonly repo?: string
  readonly engineId?: string
  readonly engineName?: string
  readonly engineColor?: string
  readonly statusKind: string
  readonly tabs: readonly { readonly id: string; readonly label: string; readonly active: boolean }[]
  readonly activeTab?: string
  readonly tabCount: number
  readonly onSelectTab: (tabId: string) => void
}

export interface PanelTabsSlotData {
  readonly taskId: string
  readonly kind: string
  readonly title: string
  readonly hint: string
  readonly tabCount: number
  readonly expanded: boolean
  readonly onToggleExpand?: () => void
  readonly onClose: () => void
}

export interface PanelSectionSlotData {
  readonly taskId: string
  readonly kind: string
  readonly title: string
  readonly branch?: string
  readonly repo?: string
  readonly engineId?: string
  readonly engineName?: string
  readonly engineColor?: string
  readonly statusKind: string
  readonly diffStats?: SlotDiffStats
  readonly todos?: { readonly done: number; readonly total: number }
  readonly pr?: SlotPrInfo
  readonly cost?: string
}

export interface StatusBarSlotData {
  readonly connection: "open" | "connecting" | "retrying"
  readonly failures: number
  readonly taskTitle?: string
  readonly branch?: string
  readonly engineName?: string
  readonly statusKind?: string
  readonly diffStats?: SlotDiffStats
  readonly usageSummary: string
  readonly onRetry: () => void
}

export interface SlotDataMap {
  readonly "shell.frame": ShellFrameSlotData
  readonly "rail.frame": RailFrameSlotData
  readonly "rail.groupHeader": RailGroupHeaderSlotData
  readonly "rail.row": RailRowSlotData
  readonly "rail.footer": RailFooterSlotData
  readonly "session.header": SessionHeaderSlotData
  readonly "panel.tabs": PanelTabsSlotData
  readonly "panel.section": PanelSectionSlotData
  readonly "status.bar": StatusBarSlotData
}

const TEMPLATE_RE = /\{\{([a-zA-Z0-9_]+)\}\}/g

/** Interpolate `{{field}}` placeholders into plain text (never markup). */
export function interpolateSlotTemplate(
  template: string,
  values: Readonly<Record<string, string | number | boolean | null | undefined>>,
): string {
  return template.replace(TEMPLATE_RE, (_match, key: string) => {
    const val = values[key]
    if (val === undefined || val === null || val === false) return ""
    return String(val)
  })
}
