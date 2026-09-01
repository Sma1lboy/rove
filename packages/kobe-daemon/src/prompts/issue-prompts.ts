/**
 * First/follow-up prompts for a session started from a story in the
 * daemon-owned issue store.
 *
 * ONE implementation, in the package both callers can reach. The TUI
 * (`kobe/src/state/issue-chat.ts`) and the web board
 * (`kobe-web/src/lib/issues.ts`) each carried a hand-kept copy of this
 * wording, and they had already drifted: the web copy interpolated the
 * product name while the TUI copy hard-coded "Rove", so the same action
 * sent different text depending on which surface you started it from.
 *
 * `product` is a parameter rather than a constant because the two callers
 * derive the display name differently (kobe-web's `cli-name.ts`, kobe's
 * `product.ts`) — passing it in is what let the two copies collapse into
 * this one.
 */

import type { Issue } from "../daemon/issues-store.ts"

function promptHeader(issue: Issue): string[] {
  const lines = [`Work on user story #${issue.id}: ${issue.title}`, ""]
  const body = issue.body.trim()
  if (body) lines.push(body, "")
  return lines
}

/** First message for a worktree-task session. */
export function issueWorktreePrompt(issue: Issue, api: string, product: string): string {
  return [
    ...promptHeader(issue),
    `Treat this as the story's dedicated ${product} task session: work only in this task worktree, and preserve any repo init instructions already delivered to the session.`,
    "Before finishing, verify the acceptance criteria implied by the story and summarize what changed plus any verification still needed.",
    "Then merge the task branch back into the current project's main branch after the worktree is clean and checks pass.",
    `When the work lands, run: ${api} issue-set-status --repo . --id ${issue.id} --status done`,
  ].join("\n")
}

/** First message for a chat directly on the project checkout — no worktree,
 *  so the worktree/merge instructions are replaced with a stay-put note. */
export function issueProjectPrompt(issue: Issue, api: string): string {
  return [
    ...promptHeader(issue),
    "You are working directly in the project checkout — no dedicated worktree or branch was created. Keep changes reviewable and do not switch branches unless asked.",
    "Before finishing, verify the acceptance criteria implied by the story and summarize what changed plus any verification still needed.",
    `When the work lands, run: ${api} issue-set-status --repo . --id ${issue.id} --status done`,
  ].join("\n")
}

/**
 * Follow-up for a linked issue after implementation has run in its task
 * worktree. Delivered to the task session rather than merged in the UI: the
 * engine owns the final code/check/conflict work.
 */
export function issueMergePrompt(issue: Issue, api: string): string {
  return [
    `Finish user story #${issue.id}: ${issue.title}`,
    "",
    "Verify the acceptance criteria implied by the story, then summarize what changed and any verification still needed.",
    "Then merge this task branch back into the current project's main branch after the worktree is clean and checks pass. Resolve conflicts if needed.",
    `When the work lands, run: ${api} issue-set-status --repo . --id ${issue.id} --status done`,
  ].join("\n")
}
