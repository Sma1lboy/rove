/**
 * `rove skill <install|status|print>`: argv handling and what each verb tells
 * the user. Detection and the copy are stubbed — `test/lib/skill-install.test.ts`
 * covers them on a real filesystem.
 */

import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SkillTarget } from "../../src/lib/skill-install.ts"

const target = (vendor: string, state: SkillTarget["state"], version: number | null = 90): SkillTarget => ({
  vendor,
  displayName: vendor === "claude" ? "Claude" : "Codex",
  dir: `/home/u/.${vendor}/skills/rove`,
  state,
  version: state === "not-installed" ? null : version,
})

const mocks = vi.hoisted(() => ({
  skillTargets: vi.fn(),
  installSkill: vi.fn(),
  installedSkillDiffersFromBundled: vi.fn(() => false),
}))

vi.mock("../../src/lib/skill-install.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/skill-install.ts")>()
  return {
    ...actual,
    skillTargets: mocks.skillTargets,
    skillOverview: () => actual.skillOverview(mocks.skillTargets()),
    installSkill: mocks.installSkill,
    installedSkillDiffersFromBundled: mocks.installedSkillDiffersFromBundled,
  }
})

import { runSkillSubcommand } from "../../src/cli/skill-cmd.ts"

let outSpy: MockInstance<typeof process.stdout.write>
let errSpy: MockInstance<typeof process.stderr.write>
let exitSpy: MockInstance<typeof process.exit>

beforeEach(() => {
  mocks.skillTargets.mockReset().mockReturnValue([target("claude", "installed"), target("codex", "not-installed")])
  mocks.installSkill.mockReset().mockImplementation((ts: SkillTarget[]) => ts.map((t) => ({ target: t, error: null })))
  mocks.installedSkillDiffersFromBundled.mockReset().mockReturnValue(false)
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`)
  }) as never)
  process.exitCode = undefined
})

afterEach(() => {
  outSpy.mockRestore()
  errSpy.mockRestore()
  exitSpy.mockRestore()
  process.exitCode = undefined
})

const out = () => outSpy.mock.calls.map((c) => String(c[0])).join("")
const err = () => errSpy.mock.calls.map((c) => String(c[0])).join("")

describe("usage / dispatch", () => {
  it("no verb prints usage and sets exitCode 2", async () => {
    await runSkillSubcommand([])
    expect(out()).toContain("usage:")
    expect(process.exitCode).toBe(2)
  })

  it("the removed `command` verb is an unknown verb", async () => {
    await expect(runSkillSubcommand(["command"])).rejects.toThrow("exit 2")
    expect(err()).toContain('unknown verb "command"')
  })
})

describe("rove skill status", () => {
  it("lists each engine with its own state and points at install when one is missing", async () => {
    await runSkillSubcommand(["status"])
    expect(out()).toMatch(/Claude\s+✓ v90/)
    expect(out()).toMatch(/Codex\s+✗ not installed/)
    expect(out()).toContain("rove skill install")
  })

  it("says so when no supported agent is set up, with the manual fallback", async () => {
    mocks.skillTargets.mockReturnValue([])
    await runSkillSubcommand(["status"])
    expect(out()).toContain("no supported coding agent")
    expect(out()).toContain("rove --skill >")
  })
})

describe("rove skill install", () => {
  it("installs into every engine set up here by default", async () => {
    await runSkillSubcommand(["install"])
    expect(mocks.installSkill.mock.calls[0]?.[0].map((t: SkillTarget) => t.vendor)).toEqual(["claude", "codex"])
    expect(out()).toContain("installed.")
  })

  it("--agent narrows to the named engines (both spellings)", async () => {
    await runSkillSubcommand(["install", "--agent=codex"])
    expect(mocks.installSkill.mock.calls[0]?.[0].map((t: SkillTarget) => t.vendor)).toEqual(["codex"])
  })

  it("refuses an engine that isn't set up, naming what is", async () => {
    await expect(runSkillSubcommand(["install", "--agent", "gemini"])).rejects.toThrow("exit 2")
    expect(err()).toContain("gemini")
    expect(err()).toContain("available: claude, codex")
    expect(mocks.installSkill).not.toHaveBeenCalled()
  })

  it("exits non-zero and names the engine when a copy fails", async () => {
    mocks.installSkill.mockReturnValue([{ target: target("codex", "not-installed"), error: "EACCES" }])
    await expect(runSkillSubcommand(["install"])).rejects.toThrow("exit 1")
    expect(err()).toContain("Codex: EACCES")
  })
})

describe("rove skill print", () => {
  it("prints the bundled SKILL.md verbatim (the `rove --skill` body)", async () => {
    await runSkillSubcommand(["print"])
    expect(out()).toContain("rove-skill-version")
  })
})
