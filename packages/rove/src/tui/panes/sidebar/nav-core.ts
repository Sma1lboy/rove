/**
 * The sidebar's navigation rail: which SURFACE is open. A separate axis from
 * the task list view (which filters tasks inside Workspace) — one enum would
 * mix view toggles with page destinations. Vertical because the rail is 24
 * cells wide and horizontal chips would truncate.
 */

/**
 * What the content pane shows. `terminal` (default) is the selected task's
 * session and has no rail row — selecting a task gets you back. Anything else
 * is a registered page's id (`tui-react/pages/registry.ts`).
 */
export type SidebarNav = "terminal" | (string & {})

/**
 * Keymap actions a page may claim as its opener. Closed: a plugin page must
 * not take over an arbitrary chord. Each opens at most one page.
 */
export const PAGE_ACTIONS = ["kanban.open", "automations.open", "workItems.open"] as const
export type PageAction = (typeof PAGE_ACTIONS)[number]

export function isPageAction(value: string): value is PageAction {
  return (PAGE_ACTIONS as readonly string[]).includes(value)
}

/**
 * Focus after moving to `nav`. Rail pages gate their keys on focus, so without
 * this Automations showed "Press n to create one" while `n` hit the sidebar's
 * new-task chord. Leaving returns focus to the sidebar.
 */
export function focusPaneForNav(nav: SidebarNav): "sidebar" | "workspace" {
  return nav === "terminal" ? "sidebar" : "workspace"
}
