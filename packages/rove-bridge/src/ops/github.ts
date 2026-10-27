/** The signed-in user's GitHub repositories, read through the machine's own `gh` login. */

import { taskOpDeps } from "./tasks-shared.ts"
import type { OpTable } from "./types.ts"

const LIST_TIMEOUT_MS = 15_000

interface GithubRepo {
  readonly nameWithOwner: string
  readonly description: string
  readonly isPrivate: boolean
}

function parseRepos(stdout: string): GithubRepo[] | null {
  let rows: unknown
  try {
    rows = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(rows)) return null
  return rows.flatMap((row: { nameWithOwner?: unknown; description?: unknown; isPrivate?: unknown }) =>
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
}

export const githubOps: OpTable = {
  "github.repos": {
    kind: "read",
    destructive: false,
    wraps: "gh repo list --limit 100 --json nameWithOwner,description,isPrivate (the machine's own gh login)",
    async run() {
      const res = await taskOpDeps.gh(
        ["repo", "list", "--limit", "100", "--json", "nameWithOwner,description,isPrivate"],
        LIST_TIMEOUT_MS,
      )
      if (!res.ok) return { repos: [], reason: res.reason }
      const repos = parseRepos(res.stdout)
      return repos ? { repos } : { repos: [], reason: "failed" }
    },
  },
}
