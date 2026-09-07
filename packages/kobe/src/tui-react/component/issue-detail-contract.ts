/**
 * What the story drawer PROMISES the kanban page — its input options and the
 * shape of every way it can be left. Split out of `issue-detail-dialog.tsx`
 * when the STATUS field pushed that file past the size cap: the seam is that
 * this half is the page's contract (stable, read by the page and by tests to
 * assert what a keypress produced) while the other half is how the drawer
 * DRAWS itself (fields, focus cycle, paste handling, chip rows).
 *
 * Nothing here renders, so the page can depend on the contract without
 * pulling in the view, and a change to the drawer's layout cannot silently
 * change what the page receives.
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

/** Every outcome carries the drafted title/body/status — the page saves a
 *  dirty patch regardless of how the drawer was left. `jump` is the drawer's
 *  follow-or-stay toggle, orthogonal to placement. */
export type IssueDetailOutcome =
  | ({ kind: "start"; vendor: VendorId; placement: IssueChatPlacement; jump: boolean } & IssueDraft)
  | ({ kind: "open"; taskId: string } & IssueDraft)
  /** Drop the story's task link — the only way back out of In progress when
   *  the linked task is gone (deleted before the daemon unlinked, or a store
   *  restored from an older home). The page clears `taskId`; the task, its
   *  branch and its worktree are untouched. */
  | ({ kind: "unlink" } & IssueDraft)
  | ({ kind: "close" } & IssueDraft)
  /** Create-mode result — `start` null = save only ("New story" Save). */
  | {
      kind: "create"
      title: string
      body: string
      start: { vendor: VendorId; placement: IssueChatPlacement; jump: boolean } | null
    }
