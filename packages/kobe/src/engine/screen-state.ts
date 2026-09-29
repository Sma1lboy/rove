/**
 * Declarative screen-state classification — the poll-side fallback for
 * engines WITHOUT persisted completion markers (copilot, kimi's no-hook
 * mode, future plugin-registered engines).
 *
 * Turns the quiescence poll's pane capture into working / blocked / idle by
 * evaluating an engine-owned rule list against the bottom of the screen.
 *
 * DATA, not code: engines and plugins declare a manifest, so no neutral layer
 * names a vendor. First match wins (blocked before working); null = no match,
 * and callers keep their previous reading rather than flapping. Pure.
 */

/** One classification rule. All present conditions must hold. */
interface ScreenRule {
  /** State this rule claims when it matches. */
  readonly state: "working" | "blocked" | "idle"
  /** Trailing NON-EMPTY capture lines the rule looks at (default 12) —
   *  engine dialogs and status lines live at the bottom of the screen. */
  readonly bottomLines?: number
  /** Every string must appear (case-insensitive) somewhere in the region. */
  readonly all?: readonly string[]
  /** At least one of these strings must appear (case-insensitive). */
  readonly any?: readonly string[]
  /** At least one region line must match one of these regexes (case-insensitive). */
  readonly lineRegex?: readonly string[]
}

/** An engine's screen-state manifest. Rules are evaluated in order; the
 *  first match wins (declare blocked before working). */
export interface EngineScreenManifest {
  readonly rules: readonly ScreenRule[]
}

const DEFAULT_BOTTOM_LINES = 12

/** The trailing non-empty lines of a capture, oldest→newest. */
function bottomRegion(captureText: string, lines: number): readonly string[] {
  const nonEmpty = captureText.split("\n").filter((l) => l.trim().length > 0)
  return nonEmpty.slice(-lines)
}

function ruleMatches(rule: ScreenRule, region: readonly string[]): boolean {
  const haystack = region.join("\n").toLowerCase()
  if (rule.all && !rule.all.every((s) => haystack.includes(s.toLowerCase()))) return false
  if (rule.any && !rule.any.some((s) => haystack.includes(s.toLowerCase()))) return false
  if (rule.lineRegex) {
    const regexes = rule.lineRegex.map((r) => new RegExp(r, "i"))
    if (!region.some((line) => regexes.some((re) => re.test(line)))) return false
  }
  // A rule with no conditions matches nothing (a bare state claim would
  // classify every screen).
  return Boolean(rule.all || rule.any || rule.lineRegex)
}

/**
 * Classify a pane capture against an engine's manifest. `null` = no rule
 * matched — the caller should keep its previous reading.
 */
export function classifyScreen(
  manifest: EngineScreenManifest,
  captureText: string,
): "working" | "blocked" | "idle" | null {
  for (const rule of manifest.rules) {
    const region = bottomRegion(captureText, rule.bottomLines ?? DEFAULT_BOTTOM_LINES)
    if (region.length === 0) continue
    if (ruleMatches(rule, region)) return rule.state
  }
  return null
}

/** Rows a wrapped error may span below its marker row. */
const MAX_ERROR_ROWS = 6

/**
 * The newest error an engine drew (registry `errorLine`) within the bottom of
 * the screen, its wrapped continuation rows joined — or undefined. Bottom-only
 * so an error the engine has since recovered from is not pinned on a later,
 * healthy turn. `last` additionally requires the error to be the final thing
 * on screen: a turn still claimed as running has ended in that error only if
 * nothing was drawn after it.
 */
export function screenErrorLine(
  errorLine: RegExp,
  rows: readonly string[],
  opts: { readonly last?: boolean } = {},
): string | undefined {
  const filled = rows.flatMap((row, index) => (row.trim() ? [index] : []))
  const window = filled.slice(-DEFAULT_BOTTOM_LINES)
  for (let k = window.length - 1; k >= 0; k--) {
    const start = window[k] as number
    if (!errorLine.test(rows[start] ?? "")) continue
    // A wrapped error continues on the rows directly below it, up to a blank row.
    let end = start + 1
    while (end < rows.length && end - start < MAX_ERROR_ROWS && rows[end]?.trim()) end++
    if (opts.last && filled.some((index) => index >= end)) return undefined
    return rows
      .slice(start, end)
      .map((row) => row.trim())
      .join(" ")
  }
  return undefined
}
