/**
 * The review queue: pull requests that ask for the signed-in user's review, in the projects Rove knows, read
 * through the machine's own `gh` (one fixed GraphQL query; nothing here writes to GitHub). `review.prepare`
 * fetches one PR's head into a local ref so a task can start from it.
 */

import { BridgeError, optInt } from "../protocol.ts"
import { optBool } from "../protocol.ts"
import { knownRepo, taskOpDeps } from "./tasks-shared.ts"
import type { OpTable } from "./types.ts"

const GH_TIMEOUT_MS = 20_000
/** A browse surface: short enough to follow a re-request, long enough that flipping pages doesn't re-ask GitHub. */
const TTL_MS = 60_000
const LIMIT = 50

const SEARCH = "is:pr is:open review-requested:@me archived:false sort:updated-desc"
const QUERY = `query($q: String!, $n: Int!) {
  search(query: $q, type: ISSUE, first: $n) {
    nodes {
      ... on PullRequest {
        number title url isDraft createdAt updatedAt additions deletions
        headRefName baseRefName isCrossRepository
        author { login }
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`

export type Checks = "passing" | "failing" | "pending"

export interface ReviewPr {
  /** The project's checkout on this Mac. */
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
  /** The head lives in someone's fork. */
  readonly fork: boolean
  readonly checks?: Checks
}

interface RawPr {
  number?: unknown
  title?: unknown
  url?: unknown
  isDraft?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  additions?: unknown
  deletions?: unknown
  headRefName?: unknown
  baseRefName?: unknown
  isCrossRepository?: unknown
  author?: { login?: unknown } | null
  repository?: { nameWithOwner?: unknown } | null
  commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: { state?: unknown } | null } | null }> | null } | null
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)

function checksOf(raw: RawPr): Checks | undefined {
  const state = raw.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state
  if (state === "SUCCESS") return "passing"
  if (state === "FAILURE" || state === "ERROR") return "failing"
  if (state === "PENDING" || state === "EXPECTED") return "pending"
  return undefined
}

/** Defensive about `gh`'s JSON; a row without a number, a title or a repository is dropped. */
export function parseQueue(stdout: string): RawPr[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  const nodes = (parsed as { data?: { search?: { nodes?: unknown } } })?.data?.search?.nodes
  return Array.isArray(nodes) ? (nodes as RawPr[]) : null
}

/** Projects Rove knows, by their GitHub id (`github.com/owner/name`, lowercased). */
async function knownProjects(ctx: Parameters<NonNullable<OpTable[string]>["run"]>[1]): Promise<Map<string, string>> {
  const paths = new Set(taskOpDeps.savedRepos())
  const { tasks } = await ctx.api.rpc<{ tasks: ReadonlyArray<{ repo: string }> }>("task.list")
  for (const task of tasks) paths.add(task.repo)
  const byId = new Map<string, string>()
  for (const path of paths) {
    const id = taskOpDeps.repoId(path)
    if (id && !byId.has(id)) byId.set(id, path)
  }
  return byId
}

export function createReviewOps(now: () => number = Date.now): OpTable {
  let cached: { at: number; raw: RawPr[] } | null = null
  return {
    "review.queue": {
      kind: "read",
      destructive: false,
      wraps:
        "gh api graphql (one fixed read-only search query: open PRs awaiting your review), the machine's own gh login",
      async run(args, ctx) {
        if (!optBool(args, "refresh") && cached && now() - cached.at <= TTL_MS)
          return shape(cached.raw, await knownProjects(ctx))
        const res = await taskOpDeps.gh(
          ["api", "graphql", "-F", `n=${LIMIT}`, "-f", `q=${SEARCH}`, "-f", `query=${QUERY}`],
          GH_TIMEOUT_MS,
        )
        if (!res.ok) return { prs: [], other: 0, reason: res.reason }
        const raw = parseQueue(res.stdout)
        if (!raw) return { prs: [], other: 0, reason: "failed" }
        cached = { at: now(), raw }
        return shape(raw, await knownProjects(ctx))
      },
    },
    "review.prepare": {
      kind: "write",
      destructive: false,
      wraps:
        "git fetch origin +refs/pull/<number>/head:refs/rove/pr/<number> (local refs only; nothing is written to GitHub)",
      async run(args, ctx) {
        const repo = await knownRepo(args, ctx)
        const number = optInt(args, "number", 1, 1_000_000_000)
        if (number === undefined) throw new BridgeError("BAD_ARGS", "number must be a pull request number")
        const res = await taskOpDeps.fetchPullHead(repo, number)
        if (!res.ok) throw new BridgeError("FETCH_FAILED", res.error)
        return { ref: res.ref }
      },
    },
  }
}

function shape(raw: readonly RawPr[], projects: ReadonlyMap<string, string>) {
  const prs: ReviewPr[] = []
  let other = 0
  for (const pr of raw) {
    const nameWithOwner = str(pr.repository?.nameWithOwner)
    if (typeof pr.number !== "number" || typeof pr.title !== "string" || !nameWithOwner) continue
    const repo = projects.get(`github.com/${nameWithOwner}`.toLowerCase())
    if (!repo) {
      other++
      continue
    }
    const checks = checksOf(pr)
    prs.push({
      repo,
      nameWithOwner,
      number: pr.number,
      title: pr.title,
      url: str(pr.url),
      ...(str(pr.author?.login) ? { author: str(pr.author?.login) } : {}),
      isDraft: pr.isDraft === true,
      createdAt: str(pr.createdAt),
      updatedAt: str(pr.updatedAt),
      additions: num(pr.additions),
      deletions: num(pr.deletions),
      headRef: str(pr.headRefName),
      baseRef: str(pr.baseRefName),
      fork: pr.isCrossRepository === true,
      ...(checks ? { checks } : {}),
    })
  }
  return { prs, other }
}

export const reviewOps: OpTable = createReviewOps()
