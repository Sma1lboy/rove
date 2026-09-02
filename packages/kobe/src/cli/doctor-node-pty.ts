/**
 * `rove doctor` row for node-pty's macOS `spawn-helper`. node-pty@1.1.0 is
 * published with `prebuilds/darwin-*\/spawn-helper` at 0644 and no installer
 * adds the exec bit back, so every PTY spawn through node-pty fails until
 * something runs chmod (issue #85). The root `postinstall` does that for
 * installs made after the fix; this row is for the tree that predates it,
 * so the symptom has a name instead of a silent dead terminal.
 */

import { readdirSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

export type SpawnHelper = { path: string; executable: boolean }

/** node-pty's darwin spawn-helpers next to the package this process resolves. */
export function installedSpawnHelpers(): SpawnHelper[] {
  let pkg: string
  try {
    // createRequire, not import.meta.resolve: the latter is missing under
    // vitest's SSR transform, and this row must be testable there.
    pkg = dirname(createRequire(import.meta.url).resolve("node-pty/package.json"))
  } catch {
    return []
  }
  const prebuilds = join(pkg, "prebuilds")
  let arches: string[]
  try {
    arches = readdirSync(prebuilds).filter((name) => name.startsWith("darwin-"))
  } catch {
    return []
  }
  const helpers: SpawnHelper[] = []
  for (const arch of arches) {
    const path = join(prebuilds, arch, "spawn-helper")
    try {
      helpers.push({ path, executable: (statSync(path).mode & 0o100) !== 0 })
    } catch {
      // no helper for this arch — nothing to check
    }
  }
  return helpers
}

/** Doctor lines plus the broken paths (empty when healthy). */
export function spawnHelperDoctorLines(helpers: readonly SpawnHelper[]): { lines: string[]; broken: string[] } {
  const broken = helpers.filter((helper) => !helper.executable).map((helper) => helper.path)
  if (helpers.length === 0) return { lines: ["node-pty: ? no darwin spawn-helper found next to node-pty"], broken }
  if (broken.length === 0) return { lines: [`node-pty: ✓ spawn-helper executable (${helpers.length} arch)`], broken }
  return {
    lines: [
      "node-pty: ✗ spawn-helper is not executable — every node-pty PTY spawn fails",
      ...broken.map((path) => `          ${path}`),
      `          → chmod 755 ${broken.join(" ")}`,
    ],
    broken,
  }
}
