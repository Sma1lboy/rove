/**
 * Declarative screen-state classification — the poll-side fallback for
 * engines WITHOUT persisted completion markers (copilot, kimi's no-hook
 * mode, future plugin-registered engines).
 *
 * The quiescence poll already captures each engine pane's text; for
 * marker-less engines it could only ever say "unknown". This module turns
 * that capture into working / blocked / idle by evaluating an engine-owned
 * rule list against the visible bottom of the screen — the same shape
 * herdr's agent-detection manifests use (refs/herdr
 * src/detect/manifests/*.toml, studied with attribution), reduced to the
 * three checks kobe actually needs: substring conjunction, substring
 * alternation, and per-line regex.
 *
 * DATA, not code, on purpose: an engine (or later a plugin) declares a
 * manifest; no neutral layer names a vendor. First matching rule wins, so
 * blocked rules go before working rules. A null answer means "no rule
 * matched" — callers keep their previous reading rather than flapping.
 *
 * Pure (no I/O), so it's unit-tested directly.
 */

/** One classification rule. All present conditions must hold. */
export interface ScreenRule {
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

/** A composer-empty detection rule. Matching a rule means "the composer is
 *  empty" (only the prompt glyph + allowed status decoration is present). */
export interface ComposerEmptyRule {
  /** Trailing NON-EMPTY capture lines the rule looks at (default 3). */
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
  /** Rules that identify an empty composer. If the manifest has rules and
   *  none match, the composer is treated as non-empty (fail-closed). If the
   *  manifest is absent, the C-layer gate is skipped (fail-open). */
  readonly composerEmpty?: readonly ComposerEmptyRule[]
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
