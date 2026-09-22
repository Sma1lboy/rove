#!/usr/bin/env bun
/**
 * Regenerate `src/engine/tier-rubric.generated.ts` from
 * `docs/design/auto-routing/`.
 *
 *   bun run build:rubric
 *
 * Run it after editing the handbook, the shots, or `jev-head.py`'s literals,
 * and commit the result. The generated module is checked in because the
 * published CLI ships `src/` and not `docs/` — a runtime read would be a file
 * that is not in the package.
 *
 * `test/engine/tier-rubric-generated.test.ts` re-runs the same assembly over
 * the same sources in CI and fails when the committed file has drifted, so
 * forgetting this step is a red test rather than a prompt nobody reviewed.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildTierRubric } from "../src/engine/tier-rubric-source.ts"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
export const SOURCE_DIR = join(repoRoot, "docs", "design", "auto-routing")
const OUT = join(here, "..", "src", "engine", "tier-rubric.generated.ts")

export function readSources(dir: string = SOURCE_DIR) {
  return {
    rubricMarkdown: readFileSync(join(dir, "rubric-annotator-v5.md"), "utf8"),
    shotsJson: readFileSync(join(dir, "jev-shots.json"), "utf8"),
    headPython: readFileSync(join(dir, "jev-head.py"), "utf8"),
  }
}

const HEADER = `/**
 * GENERATED — do not edit. Run \`bun run build:rubric\` instead.
 *
 * The judgement the tier classifier applies, assembled from
 * \`docs/design/auto-routing/\` by \`scripts/build-tier-rubric.ts\`:
 *
 *   - the three \`what\` bodies come from \`rubric-annotator-v5.md\`;
 *   - the \`role\`, \`criterion\` and per-tier \`边界\` come from \`jev-head.py\`;
 *   - the examples come from \`jev-shots.json\`.
 *
 * That is the configuration the design's numbers were measured on: 73.0% on
 * a 94-row human-labelled set whose floor (always answer \`standard\`) is
 * 48.9%, with deep recall 17/20. The two shapes that are easy to drop and
 * cost the most: each option carries its OWN boundary rule rather than one
 * shared paragraph in the instructions (+3.2 points), and the examples ride
 * along in \`state\` (swift recall 32% → 62%). See
 * \`docs/design/auto-routing-classifier-interface.md\`.
 *
 * It is DATA rather than a file read at request time, which is the one place
 * this deliberately differs from upstream. Upstream re-reads the handbook per
 * request so that editing it changes behaviour immediately; shipped in a
 * product, that would mean two runs of the same Rove version could judge the
 * same sentence differently. Here the judgement is pinned to a release, and
 * changing it is a diff someone reviews.
 */

import type { TierRubric } from "./tier-rubric-types.ts"

export const DEFAULT_TIER_RUBRIC: TierRubric = `

function emit(): string {
  const rubric = buildTierRubric(readSources())
  return `${HEADER}${JSON.stringify(rubric, null, 2)}\n`
}

if (import.meta.main) {
  writeFileSync(OUT, emit(), "utf8")
  // Hand the result to the repo's own formatter rather than teaching this
  // script biome's rules: the generated file is linted like every other file
  // in `src/`, so the two must agree, and only one of them can be the
  // authority on what "formatted" means.
  const format = Bun.spawnSync(
    [join(repoRoot, "node_modules", ".bin", "biome"), "check", "--write", "--config-path", repoRoot, OUT],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
  )
  if (format.exitCode !== 0) {
    process.stderr.write(format.stderr.toString())
    throw new Error("biome refused the generated rubric — fix the emitter, not the file")
  }
  process.stdout.write(`wrote ${OUT}\n`)
}
