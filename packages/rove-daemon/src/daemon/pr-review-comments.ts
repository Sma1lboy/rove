/**
 * On-demand read of a PR's UNRESOLVED review threads, so an agent or a user
 * can act on review feedback by file and line without its own `gh` plumbing.
 *
 * Paginated `gh api graphql` calls in the task's worktree: review threads (and their
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

const QUERY = `query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 20) {
            pageInfo { hasNextPage endCursor }
            nodes { author { login } body url }
          }
        }
      }
    }
  }
}`

const COMMENTS_QUERY = `query($id: ID!, $cursor: String!) {
  node(id: $id) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { author { login } body url }
      }
    }
  }
}`

function nextCursor(connection: unknown, previous: string | null): string | null {
  const page = record(record(connection).pageInfo)
  if (page.hasNextPage !== true) return null
  if (typeof page.endCursor !== "string" || !page.endCursor || page.endCursor === previous) {
    throw new Error("GitHub returned an invalid pagination cursor")
  }
  return page.endCursor
}

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
    const request = async (
      query: string,
      fields: string[],
    ): Promise<{ ok: true; payload: unknown } | { ok: false; unavailable: PrChecksUnavailable }> => {
      const read = await ghText(
        ["api", "graphql", ...fields, "-f", `query=${query}`],
        opts.worktreePath,
        PR_VIEW_TIMEOUT_MS,
      )
      if (!read.ok) {
        logDaemonInfo("pr-review-comments", `gh could not read PR #${opts.prNumber}: ${read.detail}`)
        return { ok: false, unavailable: { reason: "gh_failed", detail: read.detail } }
      }
      return { ok: true, payload: JSON.parse(read.stdout) }
    }
    const retained: Record<string, unknown>[] = []
    let totalUnresolved = 0
    let cursor: string | null = null
    do {
      const read = await request(QUERY, [
        "-F",
        "owner={owner}",
        "-F",
        "repo={repo}",
        "-F",
        `number=${opts.prNumber}`,
        ...(cursor === null ? [] : ["-f", `cursor=${cursor}`]),
      ])
      if (!read.ok) return { threads: [], totalUnresolved: 0, unavailable: read.unavailable }
      const payload = read.payload
      const connection = record(record(record(record(payload).data).repository).pullRequest).reviewThreads
      for (const node of nodes(connection)) {
        const thread = record(node)
        if (thread.isResolved === true) continue
        totalUnresolved++
        if (retained.length >= MAX_THREADS) continue
        const comments = [...nodes(thread.comments)]
        let commentCursor = nextCursor(thread.comments, null)
        while (commentCursor !== null) {
          if (typeof thread.id !== "string") throw new Error("GitHub omitted the review thread ID")
          const reply = await request(COMMENTS_QUERY, ["-f", `id=${thread.id}`, "-f", `cursor=${commentCursor}`])
          if (!reply.ok) return { threads: [], totalUnresolved: 0, unavailable: reply.unavailable }
          const page = record(record(record(reply.payload).data).node).comments
          comments.push(...nodes(page))
          commentCursor = nextCursor(page, commentCursor)
        }
        retained.push({ ...thread, comments: { nodes: comments } })
      }
      cursor = nextCursor(connection, cursor)
    } while (cursor !== null)
    const result = unresolvedThreads({ data: { repository: { pullRequest: { reviewThreads: { nodes: retained } } } } })
    return { threads: result.threads, totalUnresolved }
  } catch (err) {
    logDaemonError("pr-review-comments", err)
    return {
      threads: [],
      totalUnresolved: 0,
      unavailable: { reason: "gh_error", detail: err instanceof Error ? err.message : String(err) },
    }
  }
}
