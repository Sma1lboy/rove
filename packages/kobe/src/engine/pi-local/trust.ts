/**
 * pi's project trust. A directory holding project-config resources pi would
 * EXECUTE (`.pi/settings.json`, `.pi/extensions/`, `.pi/skills/`, …) or a
 * `.agents/skills` directory in the tree opens on a modal:
 *
 *   Trust project folder?
 *   This allows pi to load .pi settings and resources, …
 *   → Trust / Trust parent folder / Trust (this session only) / Do not trust …
 *
 * Captured from pi 0.80.6 on 2026-09-11. A hosted Rove session has nobody to
 * answer it, so the tab sits on the dialog instead of starting the turn — and
 * the trigger is not exotic: any repo shipping `.agents/skills/` (kobe does)
 * stops every Rove worktree of it.
 *
 * The store is `<agentDir>/trust.json`, a flat map of canonical path →
 * boolean, and pi resolves a cwd by walking ANCESTORS until it finds an entry.
 * So one record for the worktree covers it.
 *
 * `omp` has no such gate (verified: a session in a never-seen directory starts
 * straight into the composer), which is why only pi declares a trust writer.
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
 * Pre-trust `worktreePath` for pi. Merge-preserving and idempotent: an
 * existing store keeps every other decision it holds, and a store Rove cannot
 * parse is left untouched rather than replaced. Never throws — a Rove worktree
 * that fails to pre-trust simply shows the dialog it would have shown anyway.
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
