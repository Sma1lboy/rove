/**
 * Reading the judgement out of `docs/design/auto-routing/`.
 *
 * The rubric this product sends is not written here and is not written by
 * hand anywhere: it is READ from the same three files the measured
 * implementation reads, so "what a reviewer can read" and "what goes on the
 * wire" cannot drift apart. That drift is not hypothetical — the first
 * attempt at this feature re-typed the rubric in English from a description
 * of it, and the result shared no example with the set that produced the
 * numbers the design was argued from.
 *
 * Three files, three different things, all of them upstream:
 *
 *   - `rubric-annotator-v5.md` — the annotator handbook. Its three `## <tier>`
 *     bodies become each option's `what`. Split exactly the way
 *     `jev-head.py::_rubric_sections` splits it.
 *   - `jev-shots.json` — the 24 labelled examples that ride in `state`.
 *   - `jev-head.py` — the `role`, the single `CRITERION`, and the per-tier
 *     `BOUNDARY` rules. These are Python literals rather than data files
 *     upstream, so they are parsed out rather than transcribed; a transcript
 *     is a copy, and a copy is the thing this module exists to avoid.
 *
 * This runs in the BUILD script (`scripts/build-tier-rubric.ts`), never at
 * runtime — the published CLI ships `src/`, not `docs/`. The generated module
 * is committed, and `test/engine/tier-rubric-generated.test.ts` re-runs this
 * over the checked-in sources and fails if the two disagree.
 *
 * Every extractor throws on a shape it does not recognise. A generator that
 * degraded to a partial rubric would emit a plausible file and change the
 * model's behaviour silently, which is the one failure mode worth being loud
 * about.
 */

import { AUTO_ROUTING_TIERS, type AutoRoutingTier, isAutoRoutingTier } from "./auto-routing.ts"
import type { TierCriterion, TierExample, TierRubric } from "./tier-rubric-types.ts"

/**
 * The three tier bodies from the handbook.
 *
 * Mirrors `_rubric_sections`: split on `"## <tier> "`, stop at the next
 * `"\n## "`, drop the heading's own line. The trailing space in the marker is
 * load-bearing — the handbook's headings read `## swift —— …`, and matching
 * `## swift` without it would also match a future `## swiftly`.
 */
export function rubricSections(markdown: string): Record<AutoRoutingTier, string> {
  const out = {} as Record<AutoRoutingTier, string>
  for (const tier of AUTO_ROUTING_TIERS) {
    const after = markdown.split(`## ${tier} `)[1]
    if (after === undefined) throw new Error(`rubric has no "## ${tier} " section`)
    const section = after.split("\n## ")[0] ?? ""
    const body = section.split("\n").slice(1).join("\n").trim()
    if (!body) throw new Error(`rubric section "${tier}" is empty`)
    out[tier] = body
  }
  return out
}

/** The labelled examples, with every row checked against the tier enum. */
export function rubricExamples(json: string): TierExample[] {
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("shots file is not a non-empty array")
  return parsed.map((row, i) => {
    if (typeof row !== "object" || row === null) throw new Error(`shot ${i} is not an object`)
    const { task, tier } = row as { task?: unknown; tier?: unknown }
    if (typeof task !== "string" || !task.trim()) throw new Error(`shot ${i} has no task text`)
    if (typeof tier !== "string" || !isAutoRoutingTier(tier)) throw new Error(`shot ${i} has tier ${String(tier)}`)
    return { task, tier }
  })
}

/**
 * Join one Python string expression — `"a" "b"` across lines, with `#`
 * comments already excluded by the slice each caller passes in.
 *
 * Deliberately naive: it handles adjacent double-quoted literals with no
 * escapes, which is every string in `jev-head.py` and is checked by the
 * callers below finding what they expect. A literal that grew an escape or a
 * quote style this cannot read makes the surrounding extractor throw rather
 * than silently return half a sentence.
 */
function joinPythonStrings(source: string): string {
  const parts = [...source.matchAll(/"([^"\\]*)"/g)].map((m) => m[1] ?? "")
  if (parts.length === 0) throw new Error("no string literal found")
  return parts.join("")
}

function slice(source: string, start: string, end: string, what: string): string {
  const from = source.indexOf(start)
  if (from === -1) throw new Error(`jev-head.py has no ${what} (looked for ${JSON.stringify(start)})`)
  const rest = source.slice(from + start.length)
  const to = rest.indexOf(end)
  if (to === -1) throw new Error(`jev-head.py's ${what} is not terminated by ${JSON.stringify(end)}`)
  return rest.slice(0, to)
}

/** The one criterion every option is judged against. */
export function pythonCriterion(source: string): string {
  return joinPythonStrings(slice(source, "CRITERION = (", ")\n", "CRITERION"))
}

/** Who the model is being asked to be — an inline literal in `build_question`. */
export function pythonRole(source: string): string {
  const match = source.match(/"role":\s*("(?:[^"\\]*)")/)
  if (!match?.[1]) throw new Error('jev-head.py has no "role" literal')
  return joinPythonStrings(match[1])
}

/**
 * Each tier's boundary rule against its neighbours.
 *
 * Kept per option rather than folded into the instructions because that is
 * what was measured: moving these three paragraphs from one shared block into
 * the options themselves was worth +3.2 points on core-94.
 */
export function pythonBoundaries(source: string): Record<AutoRoutingTier, string> {
  const body = slice(source, "BOUNDARY = {", "\n}\n", "BOUNDARY")
  const out = {} as Record<AutoRoutingTier, string>
  for (const tier of AUTO_ROUTING_TIERS) {
    const entry = body.split(`"${tier}":`)[1]
    if (entry === undefined) throw new Error(`BOUNDARY has no ${tier} entry`)
    // Each entry ends at the comma that closes it: the last `",` on a line.
    const upTo = entry.split(/",\n/)[0] ?? entry
    out[tier] = joinPythonStrings(`${upTo}"`)
  }
  return out
}

/** The three sources, as the files are named in `docs/design/auto-routing/`. */
export interface RubricSourceFiles {
  readonly rubricMarkdown: string
  readonly shotsJson: string
  readonly headPython: string
}

/**
 * The whole rubric, assembled the way `build_question` assembles it.
 *
 * The criteria key `边界` is upstream's, verbatim, and is left alone on
 * purpose: `criteria` entries are read by the model as a small JSON document,
 * so a field NAME is prompt text. Translating it to `boundary` would be
 * editing the prompt that was measured, in the one place where nobody would
 * think to look for a behaviour change.
 */
export function buildTierRubric(files: RubricSourceFiles): TierRubric {
  const sections = rubricSections(files.rubricMarkdown)
  const boundaries = pythonBoundaries(files.headPython)
  const criteria = {} as Record<AutoRoutingTier, TierCriterion>
  for (const tier of AUTO_ROUTING_TIERS) criteria[tier] = { what: sections[tier], 边界: boundaries[tier] }
  return {
    role: pythonRole(files.headPython),
    criterion: pythonCriterion(files.headPython),
    criteria,
    examples: rubricExamples(files.shotsJson),
  }
}
