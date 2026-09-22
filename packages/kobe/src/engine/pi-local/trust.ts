/**
 * pi's project trust. A directory holding project-config resources pi would
 * EXECUTE (`.pi/settings.json`, `.pi/extensions/`, `.pi/skills/`, …) or a
 * `.agents/skills` directory in the tree opens on a modal:
 *
 *   Trust project folder?
 *   This allows pi to load .pi settings and resources, …
 *   → Trust / Trust parent folder / Trust (this session only) / Do not trust …
 *
 * (pi 0.80.6). Nobody answers it in a hosted session, and any repo shipping
 * `.agents/skills/` (kobe does) triggers it.
 *
 * The store is `<agentDir>/trust.json`, canonical path → boolean; pi walks a
 * cwd's ANCESTORS for an entry, so one record covers the worktree.
 *
 * `omp` has no such gate (verified in a never-seen directory).
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { type VendorHomeDeps, vendorAgentDir } from "../vendor-home.ts"

/** pi's own canonicalization: `realpathSync`, falling back to the input when
 *  the path isn't there yet (see `trust-manager` → `canonicalizePath`). */
function canonical(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** `<agentDir>/trust.json`. */
function piTrustPath(deps?: VendorHomeDeps): string {
  return path.join(vendorAgentDir("pi", deps), "trust.json")
}

/**
 * Pre-trust `worktreePath` for pi. Merge-preserving and idempotent; an
 * unparseable store is left untouched. Never throws.
 */
export function trustPiWorktree(worktreePath: string, deps?: VendorHomeDeps): void {
  const file = piTrustPath(deps)
  try {
    const existing: Record<string, boolean> = {}
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
      for (const [key, value] of Object.entries(parsed)) existing[key] = value === true
    }
    existing[canonical(worktreePath)] = true
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`)
  } catch {
    /* best-effort — never block a launch */
  }
}
