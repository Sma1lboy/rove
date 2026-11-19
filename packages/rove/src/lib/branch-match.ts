/**
 * How a branch name answers a picker query (both compared case-insensitively):
 * `"substring"` when the query appears in it; `"segments"` when the query has a
 * `/` and its pieces start the name's `/`-segments in order, so `feat/top`
 * finds `feature/topic` and `fe/lo` finds `user/feature/login`; else null.
 */
export function matchBranch(name: string, query: string): "substring" | "segments" | null {
  const q = query.trim().toLowerCase()
  const lower = name.toLowerCase()
  if (lower.includes(q)) return "substring"
  if (!q.includes("/")) return null
  const parts = q.split("/")
  let next = 0
  // Greedy is enough: taking the earliest segment for each piece never blocks a later one.
  for (const segment of lower.split("/")) {
    if (next < parts.length && segment.startsWith(parts[next] ?? "")) next++
  }
  return next === parts.length ? "segments" : null
}

/** Picker rows for `query`: substring hits first, then segment hits, each in list order. */
export function filterBranches(all: readonly string[], query: string): readonly string[] {
  if (!query.trim()) return all
  const substring: string[] = []
  const segments: string[] = []
  for (const name of all) {
    const match = matchBranch(name, query)
    if (match === "substring") substring.push(name)
    else if (match === "segments") segments.push(name)
  }
  return [...substring, ...segments]
}
