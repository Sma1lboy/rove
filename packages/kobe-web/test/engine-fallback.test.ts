import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { BUILTIN_VENDORS } from "../../kobe/src/types/vendor.ts"

/**
 * The SPA's built-in engine fallback — the list every vendor picker shows
 * before `/api/engines` answers, and the only list it ever gets from a
 * bridge too old to serve that route.
 *
 * It went stale when copilot and kimi shipped: the picker offered two of the
 * four built-ins, with no other path to reach the rest. Nothing failed —
 * the missing engines were simply unselectable.
 *
 * Read out of the module source rather than imported: `FALLBACK` is private
 * (the public surface is `useEngines`, which needs a React renderer), and
 * exporting it just to assert on it would widen the module for the test's
 * convenience.
 */

const SOURCE = readFileSync(fileURLToPath(new URL("../src/lib/engines.ts", import.meta.url)), "utf8")

function fallbackIds(): string[] {
  const block = SOURCE.match(/const FALLBACK: readonly EngineOption\[\] = \[([\s\S]*?)\n\]/)
  if (!block) throw new Error("FALLBACK list not found — did the declaration change shape?")
  return [...block[1].matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1])
}

describe("engine fallback list", () => {
  it("covers every built-in vendor", () => {
    // Sorted: the fallback's own order is cosmetic, its COVERAGE is not.
    expect(fallbackIds().sort()).toEqual([...BUILTIN_VENDORS].sort())
  })

  it("offers no engine the registry does not ship", () => {
    // A picker entry that launches nothing is worse than a missing one.
    for (const id of fallbackIds()) expect(BUILTIN_VENDORS).toContain(id)
  })
})
