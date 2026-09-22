/**
 * Starting an engine session from a kanban story. The agent reports completion
 * via `issue-set-status`, never by editing repo files. Placement is WHERE it
 * runs (jump-or-stay is the separate `IssueChatStart.jump` toggle):
 *   - `worktree`        — a new worktree task with its own workspace.
 *   - `projectWorktree` — same task, but also a chattab in the PROJECT
 *                         workspace (`EngineTab.ptyTask` viewport tab).
 *   - `project`         — no worktree: a chattab on the main-task checkout
 *                         (`task.ensureMain`).
 */

import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import {
  issueProjectPrompt as buildIssueProjectPrompt,
  issueWorktreePrompt as buildIssueWorktreePrompt,
} from "@sma1lboy/kobe-daemon/prompts/issue-prompts"
import { ROVE_PRODUCT_NAME } from "../product.ts"
import { attachmentLabel } from "../tui/lib/attachments"

export type IssueChatPlacement = "worktree" | "projectWorktree" | "project"

/** Capitalized product name ("Rove") — mirror of kobe-harness's `cli-name.ts`. */
function displayProductName(): string {
  return ROVE_PRODUCT_NAME.charAt(0).toUpperCase() + ROVE_PRODUCT_NAME.slice(1)
}

/** Next `images[N]:`/`pdf[N]:` placeholder index in a body draft. */
export function nextPlaceholderIndex(body: string): number {
  const matches = body.match(/^(?:images|pdf)\[\d+\]:/gm)
  return matches ? matches.length : 0
}

/** The body IS the carrier: the lines persist and ride the first prompt,
 *  where the engine reads the files itself. */
export function withImagePlaceholders(body: string, paths: readonly string[]): string {
  let next = body.replace(/\s+$/, "")
  let index = nextPlaceholderIndex(body)
  for (const path of paths) {
    const line = `${attachmentLabel(path, index)}: ${path}`
    next = next.length > 0 ? `${next}\n${line}` : line
    index += 1
  }
  return next
}

/** Drawer order: the isolated task workspace (the product unit) first. */
export const ISSUE_CHAT_PLACEMENTS: readonly IssueChatPlacement[] = ["worktree", "projectWorktree", "project"]

/** Same `#id title` shape the web uses. */
export function issueChatTaskTitle(issue: Issue): string {
  return `#${issue.id} ${issue.title}`
}

/** Shared with the web board (`kobe-daemon/prompts/issue-prompts`). */
export function issueWorktreePrompt(issue: Issue, api = "rove api"): string {
  return buildIssueWorktreePrompt(issue, api, displayProductName())
}

export function issueProjectPrompt(issue: Issue, api = "rove api"): string {
  return buildIssueProjectPrompt(issue, api)
}
