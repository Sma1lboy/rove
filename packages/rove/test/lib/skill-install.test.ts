/**
 * Skill install against a throwaway home: which engines are targets, where the
 * copy lands, and per-engine staleness. `os.homedir()` is redirected at the
 * source so nothing reaches the developer's real agent dirs.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { skillHomeFixture } from "./skill-home-fixture.ts"

const mocks = vi.hoisted(() => ({ home: "" }))
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>()
  return { ...actual, homedir: () => mocks.home }
})

import {
  ROVE_SKILL_VERSION,
  installSkill,
  parseSkillVersion,
  skillOverview,
  skillTargets,
} from "../../src/lib/skill-install.ts"

let fx: ReturnType<typeof skillHomeFixture>
beforeEach(() => {
  fx = skillHomeFixture(ROVE_SKILL_VERSION)
  mocks.home = fx.home
})
afterEach(() => fx.cleanup())

describe("skillTargets", () => {
  it("lists only engines whose home exists on this machine", () => {
    mkdirSync(join(fx.home, ".codex"))
    expect(skillTargets().map((t) => t.vendor)).toEqual(["codex"])
  })

  it("skips Claude while the Rove plugin is enabled — the plugin ships the skill", () => {
    mkdirSync(join(fx.home, ".claude"))
    mkdirSync(join(fx.home, ".codex"))
    writeFileSync(join(fx.home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "rove@m": true } }))
    expect(skillTargets().map((t) => t.vendor)).toEqual(["codex"])
  })
})

describe("installSkill", () => {
  it("copies the whole bundled skill into the engine's skills dir", () => {
    mkdirSync(join(fx.home, ".codex"))
    const results = installSkill(skillTargets(), fx.source)
    expect(results.map((r) => r.error)).toEqual([null])
    const dir = join(fx.home, ".codex", "skills", "rove")
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe(fx.skillBody(ROVE_SKILL_VERSION))
    expect(readFileSync(join(dir, "references", "ref.md"), "utf8")).toBe("ref")
    expect(skillTargets()[0]?.state).toBe("installed")
  })
})

describe("skillOverview", () => {
  it("reports staleness per engine — one current copy does not hide an old one", () => {
    fx.installAt(".claude/skills/rove", ROVE_SKILL_VERSION)
    fx.installAt(".codex/skills/rove", ROVE_SKILL_VERSION - 1)
    const overview = skillOverview()
    expect(overview.installed).toBe(true)
    expect(overview.outdated.map((t) => t.vendor)).toEqual(["codex"])
  })

  it("treats an unstamped copy as outdated", () => {
    mkdirSync(join(fx.home, ".codex", "skills", "rove"), { recursive: true })
    writeFileSync(join(fx.home, ".codex", "skills", "rove", "SKILL.md"), "no marker")
    expect(skillOverview().outdated.map((t) => t.vendor)).toEqual(["codex"])
  })
})

describe("skill version marker", () => {
  it("parses the marker", () => {
    expect(parseSkillVersion("<!-- rove-skill-version: 12 -->")).toBe(12)
    expect(parseSkillVersion("none")).toBeNull()
  })

  it("the repo SKILL.md marker is in lockstep with ROVE_SKILL_VERSION", () => {
    const repoSkill = join(dirname(fileURLToPath(import.meta.url)), "../../../../.agents/skills/rove/SKILL.md")
    expect(parseSkillVersion(readFileSync(repoSkill, "utf8"))).toBe(ROVE_SKILL_VERSION)
  })
})
