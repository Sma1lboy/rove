/**
 * `rove doctor` node-pty row: the pure formatter over injected
 * helper states, plus the real resolver against this checkout — which the
 * root postinstall has already fixed, so on macOS it must report healthy.
 */

import { describe, expect, test } from "vitest"
import { installedSpawnHelpers, spawnHelperDoctorLines } from "../../src/cli/doctor-node-pty"

describe("spawnHelperDoctorLines", () => {
  test("a 0644 helper is named with the chmod that fixes it", () => {
    const result = spawnHelperDoctorLines([
      { path: "/nm/prebuilds/darwin-arm64/spawn-helper", executable: false },
      { path: "/nm/prebuilds/darwin-x64/spawn-helper", executable: true },
    ])
    expect(result.lines[0]).toBe("node-pty: ✗ spawn-helper is not executable — every node-pty PTY spawn fails")
    expect(result.lines).toContain("          → chmod 755 /nm/prebuilds/darwin-arm64/spawn-helper")
    expect(result.broken).toEqual(["/nm/prebuilds/darwin-arm64/spawn-helper"])
  })
})

test.runIf(process.platform === "darwin")("this checkout's node-pty helpers are executable after postinstall", () => {
  const helpers = installedSpawnHelpers()
  expect(helpers.length).toBeGreaterThan(0)
  expect(helpers.every((helper) => helper.executable)).toBe(true)
})
