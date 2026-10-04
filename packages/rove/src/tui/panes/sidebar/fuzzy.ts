/**
 * Sidebar `/`-search: case-insensitive subsequence test. No scoring — the
 * caller keeps survivors in their original order.
 *
 *   fuzzyMatch("kbe", "kobe")              → true
 *   fuzzyMatch("kbe", "berserk")           → false  (order matters)
 *   fuzzyMatch("CSK", "closure-stack-k8s") → true   (case-insensitive)
 *   fuzzyMatch("", anything)               → true   (empty query passes)
 */
export function fuzzyMatch(query: string, haystack: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const h = haystack.toLowerCase()
  let qi = 0
  for (let hi = 0; hi < h.length && qi < q.length; hi++) {
    if (h.charCodeAt(hi) === q.charCodeAt(qi)) qi++
  }
  return qi === q.length
}
