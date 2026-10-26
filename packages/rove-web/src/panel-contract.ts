/**
 * The side panel's side of `rove api panel-show` and `rove api viewers`, as plain functions: what the
 * page reports about its panel (`ui.viewing`), and what a `panel` push asks of it. The stores they act
 * on live in `panel-state.ts` and `panel-report.ts`.
 */

import type { PanelTab } from "./panel-layout.ts"

/** The `panel` push the bridge sends for `rove api panel-show`. */
export interface PanelPush {
  readonly taskId: string
  readonly view: PanelTab
  /** Browser view: an absolute http(s) address. */
  readonly url?: string
  /** Files and Diff views: a file relative to the task's worktree. */
  readonly path?: string
  /** Publish time (ms epoch). */
  readonly at: number
}

const VIEWS: readonly unknown[] = ["files", "diff", "browser"] satisfies readonly PanelTab[]

export function isPanelPush(data: unknown): data is PanelPush {
  if (!data || typeof data !== "object") return false
  const p = data as Record<string, unknown>
  return (
    typeof p.taskId === "string" &&
    p.taskId !== "" &&
    VIEWS.includes(p.view) &&
    typeof p.at === "number" &&
    (p.url === undefined || typeof p.url === "string") &&
    (p.path === undefined || typeof p.path === "string")
  )
}

/**
 * What `ui.viewing` says about the panel. A narrow page has none (its Files / Diff / Browser are
 * full-pane views); a desktop page has one that zen hides.
 */
export function panelFields(layout: { narrow: boolean; panelOpen: boolean; zen: boolean }) {
  return layout.narrow
    ? { panel: false, panelOpen: false, narrow: true }
    : { panel: true, panelOpen: layout.panelOpen && !layout.zen, narrow: false }
}

/** What to do with a `panel` push on this page. */
export interface PanelPlan {
  /** The view this task's panel will show (a file's diff is the Diff view: the web has no file viewer). */
  readonly tab: PanelTab
  /** The Browser's address for the task. */
  readonly url?: string
  /** The file whose diff the Diff view opens. */
  readonly diff?: string
  /** Open the panel now: this page is on the task and has a side panel. */
  readonly show: boolean
}

/**
 * Every page remembers the view for the task; only a page that is on the task, with a side panel,
 * opens it, and it never moves to another task or takes focus.
 */
export function planPanelPush(push: PanelPush, here: { taskId: string | null; narrow: boolean }): PanelPlan {
  const tab: PanelTab = push.path ? "diff" : push.view
  return {
    tab,
    ...(push.view === "browser" && push.url ? { url: push.url } : {}),
    ...(push.view !== "browser" && push.path ? { diff: push.path } : {}),
    show: here.taskId === push.taskId && !here.narrow,
  }
}
