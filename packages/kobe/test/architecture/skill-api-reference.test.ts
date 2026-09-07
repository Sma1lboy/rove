/**
 * Drift guard for the agent skill's SECOND layer — `references/api-flags.md`.
 *
 * The skill is progressive on purpose: SKILL.md carries the hot verbs, this
 * reference carries the rest, `rove api schema` is the third layer. The middle
 * layer was hand-written and drifted — `routine-create --persistent-session`
 * and `routine-runs`' `revived`/`deferred` statuses shipped with the reference
 * listing none of them, so an agent reading the skill concluded routines can
 * only spawn a task per run. Layering does not stop that; deriving the tables
 * from the verb specs does, and this test is what makes the derivation binding.
 *
 * It also guards the two things a generator cannot own: that every group the
 * binary serves has a SECTION here at all, that SKILL.md signposts each section
 * by user intent, and that the hand-written error-code table names codes the
 * source actually throws.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { REFERENCE_PATHS, describeStale, regenerate, sectionsByGroup } from "../../../../scripts/gen-skill-api-flags.ts"
import { VERB_GROUP_IDS } from "../../src/cli/api/types.ts"

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const FIX = "bun scripts/gen-skill-api-flags.ts"

const reference = () => readFileSync(REFERENCE_PATHS[0], "utf8")
const skill = () => readFileSync(join(ROOT, ".agents", "skills", "kobe", "SKILL.md"), "utf8")

describe("api-flags.md flag tables are generated from the verb specs", () => {
  test("no generated block is stale", () => {
    const { stale } = regenerate(reference())
    expect(
      stale,
      `api-flags.md no longer matches the verb specs:\n${describeStale(stale)}\nRegenerate with: ${FIX}`,
    ).toEqual([])
  })

  test("regenerating is idempotent", () => {
    const once = regenerate(reference()).text
    expect(regenerate(once).text).toBe(once)
  })

  test("every verb group the binary serves has a section", () => {
    const sections = sectionsByGroup(reference())
    for (const group of VERB_GROUP_IDS) {
      expect(sections.get(group), `verb group "${group}" has no <!-- generated:begin --> region in api-flags.md`) //
        .toBeTruthy()
    }
  })
})

describe("SKILL.md signposts the reference by intent", () => {
  /** The right-hand column of the "Read section" lookup table. */
  function signpostedSections(): Set<string> {
    const rows = skill()
      .split("\n")
      .filter((l) => l.trim().startsWith("|") && l.trim().endsWith("|"))
      .map((l) => l.trim().slice(1, -1).split("|"))
      .filter((cells) => cells.length === 2)
    return new Set(rows.map((cells) => cells[1].trim()))
  }

  test("every section of api-flags.md is reachable from a signpost row", () => {
    const signposted = signpostedSections()
    for (const [group, section] of sectionsByGroup(reference())) {
      expect(
        signposted.has(section),
        `verb group "${group}" lives in api-flags.md's "${section}" section, but no SKILL.md signpost row points there — an agent asked for it in the user's own words will never open the file`,
      ).toBe(true)
    }
  })
})

describe("the error-code table names codes the source throws", () => {
  /**
   * The table stays hand-written: its value is the "Means"/"Recover" prose,
   * and the codes themselves are string literals scattered across handlers
   * with no registry to generate from. So guard the half that CAN rot — a
   * renamed or deleted code — without inventing one.
   */
  test("every documented code appears as a literal in the source", () => {
    // The daemon is in scope because its refusals now reach the caller as
    // their own `code` (the CLI boundary lifts the `CODE: ` message prefix
    // instead of flattening everything to RPC_ERROR), so a documented code
    // can just as well be a daemon-side literal as a CLI one.
    const source = [
      join(ROOT, "packages", "kobe", "src", "cli"),
      join(ROOT, "packages", "kobe", "src", "orchestrator"),
      join(ROOT, "packages", "kobe-daemon", "src", "daemon"),
    ]
      .map(readTsSources)
      .join("\n")
    const codes = reference()
      .split("\n")
      .filter((l) => /^\| `[A-Z][A-Z0-9_]+` \|/.test(l))
      .map((l) => l.split("`")[1])
    expect(codes.length).toBeGreaterThan(4)
    for (const code of codes) {
      expect(source.includes(`"${code}"`), `api-flags.md documents error code ${code}, which no source file throws`) //
        .toBe(true)
    }
  })
})

/** Concatenate every `.ts` under `dir` — cheaper to read than to shell out. */
function readTsSources(dir: string): string {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(readFileSync(join(entry.parentPath ?? dir, entry.name), "utf8"))
    }
  }
  return out.join("\n")
}
