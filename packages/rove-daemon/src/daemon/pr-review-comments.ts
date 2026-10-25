/**
 * On-demand read of a PR's UNRESOLVED review threads, so an agent or a user
 * can act on review feedback by file and line without its own `gh` plumbing.
 *
 * One `gh api graphql` call in the task's worktree: review threads (and their
 * resolved state) exist only in GraphQL. `{owner}`/`{repo}` are `gh`'s own
 * placeholders, filled from the worktree's remote.
 *
 * Capped at {@link MAX_THREADS} threads × {@link MAX_BODY_CHARS} per comment:
 * the result can land in an engine's context window.
 */

import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import { type PrChecksUnavailable, ghText } from "./pr-failing-checks.ts"
import { PR_VIEW_TIMEOUT_MS } from "./pr-status-collector.ts"

/** At most this many unresolved threads are reported; the rest are counted. */
export const MAX_THREADS = 50
/** A comment body longer than this is cut, with a marker. */
export const MAX_BODY_CHARS = 4000

const QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 20) { nodes { author { login } body url } }
        }
      }
    }
  }
}`

export interface PrReviewComment {
  /** GitHub login, or "ghost" for a deleted account. */
  readonly author: string
  readonly body: string
  readonly url: string
}

/** One unresolved review thread: where it points, and its conversation in order. */
export interface PrReviewThread {
  readonly path: string
  /** Line in the PR's current diff; the original line once outdated; null for a file-level comment. */
  readonly line: number | null
  /** The code it was left on has since changed. */
  readonly outdated: boolean
  readonly comments: readonly PrReviewComment[]
}

export interface PrReviewCommentsResult {
  readonly threads: readonly PrReviewThread[]
  /** Unresolved threads before the {@link MAX_THREADS} cap. */
  readonly totalUnresolved: number
  /** Set when GitHub could not be asked, so `threads: []` alone means nothing is open. */
  readonly unavailable?: PrChecksUnavailable
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function nodes(value: unknown): unknown[] {
  const list = record(value).nodes
  return Array.isArray(list) ? list : []
}

function lineOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
}

function clip(body: string): string {
  return body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n… (truncated)` : body
}

/** The unresolved threads of a `gh api graphql` answer, in GitHub's order. */
export function unresolvedThreads(payload: unknown): PrReviewCommentsResult {
  const pr = record(record(record(record(payload).data).repository).pullRequest)
  const threads: PrReviewThread[] = []
  for (const node of nodes(pr.reviewThreads)) {
    const thread = record(node)
    if (thread.isResolved === true) continue
    const comments = nodes(thread.comments).map((c) => {
      const comment = record(c)
      const login = record(comment.author).login
      return {
        author: typeof login === "string" ? login : "ghost",
        body: clip(typeof comment.body === "string" ? comment.body : ""),
        url: typeof comment.url === "string" ? comment.url : "",
      }
    })
    threads.push({
      path: typeof thread.path === "string" ? thread.path : "",
      line: lineOf(thread.line) ?? lineOf(thread.originalLine),
      outdated: thread.isOutdated === true,
      comments,
    })
  }
  return { threads: threads.slice(0, MAX_THREADS), totalUnresolved: threads.length }
}

/** Unresolved review threads for a PR. Never throws: a failure is reported in `unavailable`. */
export async function readReviewComments(opts: {
  readonly worktreePath: string
  readonly prNumber: number
}): Promise<PrReviewCommentsResult> {
  try {
    const read = await ghText(
      [
        "api",
        "graphql",
        "-F",
        "owner={owner}",
        "-F",
        "repo={repo}",
        "-F",
        `number=${opts.prNumber}`,
        "-f",
        `query=${QUERY}`,
      ],
      opts.worktreePath,
      PR_VIEW_TIMEOUT_MS,
    )
    if (!read.ok) {
      logDaemonInfo("pr-review-comments", `gh could not read PR #${opts.prNumber}: ${read.detail}`)
      return { threads: [], totalUnresolved: 0, unavailable: { reason: "gh_failed", detail: read.detail } }
    }
    return unresolvedThreads(JSON.parse(read.stdout))
  } catch (err) {
    logDaemonError("pr-review-comments", err)
    return {
      threads: [],
      totalUnresolved: 0,
      unavailable: { reason: "gh_error", detail: err instanceof Error ? err.message : String(err) },
    }
  }
}
