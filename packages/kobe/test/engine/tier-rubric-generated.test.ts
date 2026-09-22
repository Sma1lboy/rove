/**
 * The shipped rubric is the one in `docs/design/auto-routing/`.
 *
 * `src/engine/tier-rubric.generated.ts` is committed because the published
 * package ships `src/` and not `docs/`, which means there are two copies of
 * the judgement and exactly one way for them to disagree: someone edits the
 * handbook and forgets `bun run build:rubric`. This file is that way's alarm.
 *
 * The rest of the cases guard the property the copy exists to preserve —
 * that this is the text the design's numbers were measured on. They are
 * deliberately about SHAPE, not about wording: asserting the prose would just
 * be a third copy. What is asserted is what an English rewrite of the rubric
 * silently lost the first time this feature was attempted — the 24 examples,
 * the per-option boundary rules, the criteria key the model reads as a word,
 * and a `state` that carries nothing but the task text.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { AUTO_ROUTING_TIERS } from "../../src/engine/auto-routing.ts"
import { buildTierRubric, pythonBoundaries, rubricSections } from "../../src/engine/tier-rubric-source.ts"
import { DEFAULT_TIER_RUBRIC } from "../../src/engine/tier-rubric.generated.ts"

const SOURCE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "docs",
  "design",
  "auto-routing",
)

const read = (name: string) => readFileSync(join(SOURCE_DIR, name), "utf8")
const sources = () => ({
  rubricMarkdown: read("rubric-annotator-v5.md"),
  shotsJson: read("jev-shots.json"),
  headPython: read("jev-head.py"),
})

describe("the generated rubric", () => {
  it("still matches docs/design/auto-routing — run `bun run build:rubric` if this fails", () => {
    expect(DEFAULT_TIER_RUBRIC).toEqual(buildTierRubric(sources()))
  })

  it("carries the labelled examples, which is where swift's floor comes from", () => {
    // Prose cannot say how small "small" is; these can. Dropping them cost
    // swift recall 62% → 32% on the labelled set, and dropping them is
    // invisible — the request still succeeds and still returns a tier.
    expect(DEFAULT_TIER_RUBRIC.examples).toHaveLength(24)
    expect(new Set(DEFAULT_TIER_RUBRIC.examples.map((e) => e.tier))).toEqual(new Set(AUTO_ROUTING_TIERS))
  })

  it("puts each boundary rule INSIDE its own option, not in the instructions", () => {
    // Worth +3.2 points on its own. The shape is the point: a tier is judged
    // against its neighbours while that tier is being considered.
    for (const tier of AUTO_ROUTING_TIERS) {
      expect(DEFAULT_TIER_RUBRIC.criteria[tier].边界.length).toBeGreaterThan(20)
    }
    expect(DEFAULT_TIER_RUBRIC.criterion).not.toContain("分界")
  })

  it("spells the boundary key the way the measured request spelled it", () => {
    // `criteria` entries are serialized into the request, so a key is a word
    // the model reads. Renaming it to `boundary` would edit the prompt in the
    // one place a diff reads as a refactor.
    for (const tier of AUTO_ROUTING_TIERS) {
      expect(Object.keys(DEFAULT_TIER_RUBRIC.criteria[tier]).sort()).toEqual(["what", "边界"])
    }
  })
})

describe("the extractors", () => {
  it("throws rather than emitting a partial rubric when a section is missing", () => {
    // A generator that degraded quietly would write a plausible file and
    // change the model's judgement with nothing to review.
    expect(() => rubricSections("# handbook\n\n## swift —— x\nbody\n")).toThrow(/standard/)
    expect(() => pythonBoundaries('BOUNDARY = {\n    "swift": "a",\n}\n')).toThrow(/standard/)
  })

  it("reads the handbook's own section split, heading line dropped", () => {
    const sections = rubricSections(read("rubric-annotator-v5.md"))
    expect(sections.swift.startsWith("- ")).toBe(true)
    expect(sections.deep).not.toContain("## drop")
  })
})
