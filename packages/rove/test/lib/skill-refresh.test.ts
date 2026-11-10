/**
 * The daemon-boot refresh: brings installed copies up to this build and never
 * creates one the user didn't ask for.
 */

import { lstatSync, mkdirSync, readFileSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { skillHomeFixture } from "./skill-home-fixture.ts"

const mocks = vi.hoisted(() => ({ home: "" }))
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>()
  return { ...actual, homedir: () => mocks.home }
})

import { ROVE_SKILL_VERSION, refreshOutdatedSkills } from "../../src/lib/skill-install.ts"

let fx: ReturnType<typeof skillHomeFixture>
beforeEach(() => {
  fx = skillHomeFixture(ROVE_SKILL_VERSION)
  mocks.home = fx.home
})
afterEach(() => fx.cleanup())

describe("refreshOutdatedSkills", () => {
  it("updates outdated copies and leaves engines without one alone", () => {
    mkdirSync(join(fx.home, ".claude"))
    const codex = fx.installAt(".codex/skills/rove", ROVE_SKILL_VERSION - 1)
    const results = refreshOutdatedSkills(fx.source)
    expect(results.map((r) => [r.target.vendor, r.error])).toEqual([["codex", null]])
    expect(readFileSync(join(codex, "SKILL.md"), "utf8")).toBe(fx.skillBody(ROVE_SKILL_VERSION))
    expect(() => lstatSync(join(fx.home, ".claude", "skills"))).toThrow()
  })

  it("writes through an agent-skills symlink instead of replacing it", () => {
    const real = fx.installAt(".agents/skills/rove", ROVE_SKILL_VERSION - 1)
    mkdirSync(join(fx.home, ".claude", "skills"), { recursive: true })
    const link = join(fx.home, ".claude", "skills", "rove")
    symlinkSync(real, link)
    refreshOutdatedSkills(fx.source)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(real, "SKILL.md"), "utf8")).toBe(fx.skillBody(ROVE_SKILL_VERSION))
  })

  it("does nothing when every copy is current", () => {
    fx.installAt(".codex/skills/rove", ROVE_SKILL_VERSION)
    expect(refreshOutdatedSkills(fx.source)).toEqual([])
  })
})
