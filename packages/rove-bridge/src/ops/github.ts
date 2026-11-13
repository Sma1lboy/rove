/** The GitHub repositories the signed-in user can reach (their own, collaborations, their organizations'), read through the machine's own `gh` login. */

import { taskOpDeps } from "./tasks-shared.ts"
import type { OpTable } from "./types.ts"

const LIST_TIMEOUT_MS = 15_000

interface GithubRepo {
  readonly nameWithOwner: string
  readonly description: string
  readonly isPrivate: boolean
}

const QUERY =
  "query($after:String){viewer{repositories(first:100,after:$after,affiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER],ownerAffiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER],orderBy:{field:PUSHED_AT,direction:DESC}){nodes{nameWithOwner description isPrivate} pageInfo{hasNextPage endCursor}}}}"
/** Newest-pushed first, so the cap drops the stalest repos. */
const MAX_PAGES = 5

function parsePage(stdout: string): { repos: GithubRepo[]; next: string | null } | null {
  let page: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } } | undefined
  try {
    page = JSON.parse(stdout)?.data?.viewer?.repositories
  } catch {
    return null
  }
  if (!Array.isArray(page?.nodes)) return null
  const repos = page.nodes.flatMap((row: { nameWithOwner?: unknown; description?: unknown; isPrivate?: unknown }) =>
    typeof row?.nameWithOwner === "string"
      ? [
          {
            nameWithOwner: row.nameWithOwner,
            description: typeof row.description === "string" ? row.description : "",
            isPrivate: row.isPrivate === true,
          },
        ]
      : [],
  )
  const info = page.pageInfo
  return { repos, next: info?.hasNextPage === true && typeof info.endCursor === "string" ? info.endCursor : null }
}

export const githubOps: OpTable = {
  "github.repos": {
    kind: "read",
    destructive: false,
    wraps:
      "gh api graphql viewer.repositories (owner, collaborator and organization repos, newest push first, up to 500; the machine's own gh login)",
    async run() {
      const repos: GithubRepo[] = []
      let after: string | null = null
      for (let i = 0; i < MAX_PAGES; i++) {
        const res = await taskOpDeps.gh(
          ["api", "graphql", "-f", `query=${QUERY}`, ...(after ? ["-f", `after=${after}`] : [])],
          LIST_TIMEOUT_MS,
        )
        const page = res.ok ? parsePage(res.stdout) : null
        // A later page failing keeps the pages already read.
        if (!page) return repos.length > 0 ? { repos } : { repos: [], reason: res.ok ? "failed" : res.reason }
        repos.push(...page.repos)
        if (!page.next) break
        after = page.next
      }
      return { repos }
    },
  },
}
