/** Session PRs: PRs a task's engine session opened from any directory, attached via `rove api pr-attach`. */

/** Most PRs one task keeps; attaching past it drops the oldest. */
export const SESSION_PR_CAP = 20

const GITHUB_PR_URL = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i

/**
 * `https://github.com/<owner>/<repo>/pull/<n>` for a PR link, tolerating a
 * trailing `/files`, query or fragment; anything else → undefined.
 */
export function canonicalPrUrl(input: string): string | undefined {
  const m = GITHUB_PR_URL.exec(input.trim())
  if (!m) return undefined
  const [, owner, repo, number] = m
  return `https://github.com/${owner}/${repo}/pull/${Number(number)}`
}
