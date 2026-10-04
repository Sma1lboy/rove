import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
  NPX_MISSING_EXIT,
  ROVE_SKILL_VERSION,
  bundledSkillDir,
  isNpxMissing,
  npxSkillsArgv,
  npxSkillsCommand,
  parseSkillVersion,
  roveSkillPaths,
  roveSkillState,
  runNpxSkillsInstall,
  skillInstallCommand,
} from "../../src/lib/skill-install.ts"

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "rove-skill-"))
  dirs.push(d)
  return d
}
function installSkillUnder(root: string, body = "skill", name = "rove"): void {
  mkdirSync(join(root, `.claude/skills/${name}`), { recursive: true })
  writeFileSync(join(root, `.claude/skills/${name}/SKILL.md`), body)
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe("roveSkillPaths", () => {
  it("covers .agents (where the CLI writes the real file) and .claude, home + project", () => {
    // The agent-skills CLI puts the real SKILL.md in .agents/skills and
    // symlinks agent dirs at it. Looking only under .claude reported "not
    // installed" for a perfectly good install.
    expect(roveSkillPaths({ home: "/h", cwd: "/p" })).toEqual([
      "/h/.agents/skills/rove/SKILL.md",
      "/h/.claude/skills/rove/SKILL.md",
      "/p/.agents/skills/rove/SKILL.md",
      "/p/.claude/skills/rove/SKILL.md",
    ])
  })
})

describe("npxSkillsArgv / npxSkillsCommand", () => {
  it("names NO agent by default — the agent-skills CLI detects and asks", () => {
    // rove deliberately owns no agent registry: ~75 agents, each with its own
    // skills dir and symlink rules. Passing an agent here would freeze that
    // list into rove.
    expect(npxSkillsArgv({ source: "/bundled" })).toEqual(["skills", "add", "/bundled", "--skill", "rove", "--global"])
    expect(npxSkillsArgv({ source: "/bundled" })).not.toContain("--agent")
  })

  it("installs from the BUNDLED path, not a repo clone", () => {
    // `npx skills add Sma1lboy/rove` is a `git clone --depth 1` = ~198MB of
    // working tree for an 8KB file. The local path skips the network.
    const dir = bundledSkillDir()
    expect(dir).not.toBeNull()
    expect(npxSkillsArgv()[2]).toBe(dir)
  })

  it("repeats --agent per agent (the CLI rejects a comma-joined list)", () => {
    expect(npxSkillsArgv({ source: "/b", agent: "cursor" })).toEqual([
      "skills",
      "add",
      "/b",
      "--skill",
      "rove",
      "--global",
      "--agent",
      "cursor",
    ])
    expect(npxSkillsCommand({ source: "/b", agent: ["claude-code", "codex"] })).toBe(
      "npx skills add /b --skill rove --global --agent claude-code --agent codex",
    )
  })
})

describe("skillInstallCommand", () => {
  it("follows the invoked canonical or compatibility entry", () => {
    expect(skillInstallCommand({ ROVE_INVOKED_AS: "rove" })).toBe("rove skill install")
    expect(skillInstallCommand({ ROVE_INVOKED_AS: "rove" })).toBe("rove skill install")
  })
})

describe("skill version / staleness", () => {
  it("parses canonical and legacy skill-version markers", () => {
    expect(parseSkillVersion("<!-- rove-skill-version: 4 -->\n# x")).toBe(4)
    expect(parseSkillVersion("<!-- rove-skill-version: 3 -->\n# x")).toBe(3)
    expect(parseSkillVersion("no marker here")).toBeNull()
  })

  it("the repo SKILL.md marker is in lockstep with ROVE_SKILL_VERSION", () => {
    // The whole staleness mechanism hinges on these two agreeing — guard it.
    const repoSkill = join(dirname(fileURLToPath(import.meta.url)), "../../../../.agents/skills/rove/SKILL.md")
    const source = readFileSync(repoSkill, "utf8")
    expect(parseSkillVersion(source)).toBe(ROVE_SKILL_VERSION)
    expect(source).toMatch(/^name: rove$/m)
    expect(source).toContain("${ROVE_TASK_ID:-}")
  })

  it("roveSkillState: a rove-only install reports no duplicate — it IS the install", () => {
    const home = tempDir()
    installSkillUnder(home, `<!-- rove-skill-version: ${ROVE_SKILL_VERSION} -->`, "rove")
    expect(roveSkillState({ home, cwd: tempDir() })).toMatchObject({ installed: true })
  })
})

/**
 * `curl https://rove.run/install.sh | sh` installs Bun and Rove and never
 * Node, so a missing `npx` is the DEFAULT state for anyone who followed the
 * QUICKSTART. `Bun.spawn` THROWS on a missing binary (unlike `spawnSync`,
 * which returns a status), and nothing on this path caught it — the throw
 * escaped to `main().catch` and printed
 * `rove failed to start: Executable not found in $PATH: "npx"`.
 */
describe("npx preflight", () => {
  it("reports npx missing when it isn't on PATH", () => {
    const realPath = process.env.PATH
    process.env.PATH = tempDir()
    try {
      expect(isNpxMissing()).toBe(true)
    } finally {
      process.env.PATH = realPath
    }
  })

  it("returns an exit code instead of throwing when npx is absent", async () => {
    const realPath = process.env.PATH
    const stderr: string[] = []
    const write = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string) => {
      stderr.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    process.env.PATH = tempDir()
    try {
      // Must RESOLVE, not reject — a bare Bun.spawn throws here.
      await expect(runNpxSkillsInstall()).resolves.toBe(NPX_MISSING_EXIT)
      const said = stderr.join("")
      expect(said).toContain("npx")
      expect(said).toContain("Node")
    } finally {
      process.env.PATH = realPath
      process.stderr.write = write
    }
  })
})
