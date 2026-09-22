/**
 * What the story drawer PROMISES the kanban page: its input options and every
 * way it can be left. Nothing here renders, so the page and tests depend on the
 * contract without the view, and a layout change can't silently change it.
 */

import type { Issue, IssueStatus } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import type { IssueChatPlacement } from "../../state/issue-chat"
import type { VendorId } from "../../types/task"

export interface IssueDetailOptions {
  readonly issue: Issue
  /** `create` turns the drawer into the new-story intake: blank drafts,
   *  esc CANCELS (nothing exists to save), ctrl+s creates without starting,
   *  enter/ctrl+enter creates AND starts at the chosen placement. */
  readonly mode?: "detail" | "create"
  /** Engines to offer (detected built-ins + custom), in cycle order. */
  readonly engines: readonly VendorId[]
  readonly defaultVendor: VendorId
  readonly engineLabel: (vendor: VendorId) => string
  /** Live daemon connection — the linked story's EVENTS feed reads from it.
   *  Absent (mocks, offline): the feed renders its empty state. */
  readonly orchestrator?: RemoteOrchestrator | null
}

/** The drafted title/body/status every non-create outcome carries — the page
 *  saves a dirty patch regardless of how the drawer was left. */
export interface IssueDraft {
  readonly title: string
  readonly body: string
  readonly status: IssueStatus
}

/** `jump` is the drawer's follow-or-stay toggle, orthogonal to placement. */
export type IssueDetailOutcome =
  | ({ kind: "start"; vendor: VendorId; placement: IssueChatPlacement; jump: boolean } & IssueDraft)
  | ({ kind: "open"; taskId: string } & IssueDraft)
  /** Drop the task link — the only way out of In progress when the linked
   *  task is gone. Clears `taskId`; task, branch and worktree are untouched. */
  | ({ kind: "unlink" } & IssueDraft)
  | ({ kind: "close" } & IssueDraft)
  /** Create-mode result — `start` null = save only ("New story" Save). */
  | {
      kind: "create"
      title: string
      body: string
      start: { vendor: VendorId; placement: IssueChatPlacement; jump: boolean } | null
    }
