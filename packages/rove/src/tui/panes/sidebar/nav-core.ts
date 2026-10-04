/**
 * The sidebar's navigation rail: which SURFACE is open. A separate axis from
 * the task list view (which filters tasks inside Workspace) — one enum would
 * mix view toggles with page destinations. Vertical because the rail is 24
 * cells wide and horizontal chips would truncate.
 */

/**
 * What the content pane shows. `terminal` (default) is the selected task's
 * session and has no rail row — selecting a task gets you back.
 */
export type SidebarNav = "terminal" | "kanban" | "automations" | "issues"

export interface SidebarNavItem {
  readonly nav: SidebarNav
  /** i18n key — callers translate with their own `t`. */
  readonly labelKey: string
  /** Existing keymap action represented by this clickable destination. */
  readonly bindingId: string
}

/** Top to bottom; no `terminal` row — the task list below is that destination. */
export const SIDEBAR_NAV_ITEMS: readonly SidebarNavItem[] = [
  { nav: "kanban", labelKey: "tasks.nav.kanban", bindingId: "kanban.open" },
  { nav: "automations", labelKey: "tasks.nav.automations", bindingId: "automations.open" },
  { nav: "issues", labelKey: "tasks.nav.issues", bindingId: "workItems.open" },
]

/** Cycle the rail by `delta`, wrapping. Null for `terminal`, which isn't on it. */
export function cycleNavTarget(cur: SidebarNav, delta: -1 | 1): SidebarNav | null {
  const idx = SIDEBAR_NAV_ITEMS.findIndex((item) => item.nav === cur)
  if (idx < 0) return null
  return SIDEBAR_NAV_ITEMS[(idx + delta + SIDEBAR_NAV_ITEMS.length) % SIDEBAR_NAV_ITEMS.length]?.nav ?? null
}

/**
 * Focus after moving to `nav`. Rail pages gate their keys on focus, so without
 * this Automations showed "Press n to create one" while `n` hit the sidebar's
 * new-task chord. Leaving returns focus to the sidebar.
 */
export function focusPaneForNav(nav: SidebarNav): "sidebar" | "workspace" {
  return nav === "terminal" ? "sidebar" : "workspace"
}
