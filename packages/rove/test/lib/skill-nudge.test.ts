/** The launch notice names each engine lacking the skill once, ever, across TUI and web. */

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { skillHomeFixture } from "./skill-home-fixture.ts"

const mocks = vi.hoisted(() => ({ home: "" }))
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>()
  return { ...actual, homedir: () => mocks.home }
})

import { ROVE_SKILL_VERSION } from "../../src/lib/skill-install.ts"
import { takeSkillNudge } from "../../src/lib/skill-nudge.ts"

let fx: ReturnType<typeof skillHomeFixture>
const savedHome = { rove: process.env.ROVE_HOME_DIR, kobe: process.env.KOBE_HOME_DIR }
beforeEach(() => {
  fx = skillHomeFixture(ROVE_SKILL_VERSION)
  mocks.home = fx.home
  // The state file must land in the fixture, never the operator's home.
  process.env.ROVE_HOME_DIR = fx.home
  process.env.KOBE_HOME_DIR = fx.home
})
afterEach(() => {
  for (const [k, v] of [
    ["ROVE_HOME_DIR", savedHome.rove],
    ["KOBE_HOME_DIR", savedHome.kobe],
  ] as const) {
    if (v === undefined) Reflect.deleteProperty(process.env, k)
    else process.env[k] = v
  }
  fx.cleanup()
})

it("names a missing engine once, skips installed ones, and names an engine set up later", () => {
  mkdirSync(join(fx.home, ".claude"))
  fx.installAt(".codex/skills/rove", ROVE_SKILL_VERSION)
  expect(takeSkillNudge()).toEqual(["Claude"])
  expect(takeSkillNudge()).toBeNull()
  mkdirSync(join(fx.home, ".cursor"))
  expect(takeSkillNudge()).toEqual(["Cursor Agent"])
})
