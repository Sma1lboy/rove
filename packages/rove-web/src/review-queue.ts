/** The Issues page's second source: PRs that ask for your review (`review.queue`), and what `[ review ]` opens. */

import { createStore } from "./store.ts"
import type { NewSessionStart } from "./ui.ts"

/** Which list the Issues page shows; the palette's "Review queue" sets it before opening the page. */
export type IssuesSource = "issues" | "reviews"
export const issuesSource = createStore<IssuesSource>("issues")

/** One `review.queue` row (the bridge's `ReviewPr`). */
export interface ReviewPr {
  readonly repo: string
  readonly nameWithOwner: string
  readonly number: number
  readonly title: string
  readonly url: string
  readonly author?: string
  readonly isDraft: boolean
  readonly createdAt: string
  readonly updatedAt: string
  readonly additions: number
  readonly deletions: number
  readonly headRef: string
  readonly baseRef: string
  readonly fork: boolean
  readonly checks?: "passing" | "failing" | "pending"
}

export interface ReviewQueueReply {
  readonly prs: readonly ReviewPr[]
  /** PRs waiting on you in projects Rove doesn't know. */
  readonly other: number
  /** Why the list is empty when `gh` could not be read. */
  readonly reason?: "missing" | "unauthenticated" | "failed"
}

/**
 * New session for a review: the PR's head (fetched into `ref`) is where the worktree starts, in the PR's project, with
 * the review prompt as an editable draft. Nothing starts until Start: the engine is picked there, and an agent never
 * begins reading a stranger's code on a click in a list.
 */
export function reviewSeed(pr: ReviewPr, ref: string, prompt: string): NewSessionStart {
  return { repo: pr.repo, baseBranch: ref, prompt, worktree: true }
}
