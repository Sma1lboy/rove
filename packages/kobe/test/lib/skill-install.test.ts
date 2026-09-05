import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
  KOBE_SKILL_VERSION,
  NPX_MISSING_EXIT,
  bundledSkillDir,
  installedSkillDirs,
  isNpxMissing,
  kobeSkillPaths,
  kobeSkillState,
  npxSkillsArgv,
  npxSkillsCommand,
  parseSkillVersion,
  runNpxSkillsInstall,
  skillInstallCommand,
} from "../../src/lib/skill-install.ts"

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "kobe-skill-"))
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

describe("kobeSkillPaths", () => {
  it("covers .agents (where the CLI writes the real file) and .claude, home + project", () => {
    // The agent-skills CLI puts the real SKILL.md in .agents/skills and
    // symlinks agent dirs at it. Looking only under .claude reported "not
    // installed" for a perfectly good install.
    expect(kobeSkillPaths({ home: "/h", cwd: "/p" })).toEqual([
      "/h/.agents/skills/rove/SKILL.md",
      "/h/.claude/skills/rove/SKILL.md",
      "/h/.agents/skills/kobe/SKILL.md",
      "/h/.claude/skills/kobe/SKILL.md",
      "/p/.agents/skills/rove/SKILL.md",
      "/p/.claude/skills/rove/SKILL.md",
      "/p/.agents/skills/kobe/SKILL.md",
      "/p/.claude/skills/kobe/SKILL.md",
    ])
  })
})

describe("npxSkillsArgv / npxSkillsCommand", () => {
  it("names NO agent by default — the agent-skills CLI detects and asks", () => {
    // kobe deliberately owns no agent registry: ~75 agents, each with its own
    // skills dir and symlink rules. Passing an agent here would freeze that
    // list into kobe.
    expect(npxSkillsArgv({ source: "/bundled" })).toEqual(["skills", "add", "/bundled", "--skill", "rove", "--global"])
    expect(npxSkillsArgv({ source: "/bundled" })).not.toContain("--agent")
  })

  it("installs GLOBAL by default; global:false opts into project-level", () => {
    // The skill drives a machine-wide daemon — one user-level copy, one
    // staleness lifecycle, instead of a re-prompt in every repo.
    expect(npxSkillsArgv({ source: "/b" })).toContain("--global")
    expect(npxSkillsArgv({ source: "/b", global: false })).not.toContain("--global")
  })

  it("installs from the BUNDLED path, not a repo clone", () => {
    // `npx skills add Sma1lboy/rove` is a `git clone --depth 1` = ~198MB of
    // working tree for an 8KB file. The local path skips the network.
    const dir = bundledSkillDir()
    expect(dir).not.toBeNull()
    expect(npxSkillsArgv()[2]).toBe(dir)
  })

  it("falls back to the repo slug when nothing is bundled", () => {
    expect(npxSkillsArgv({ source: null })).toContain("Sma1lboy/rove")
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
    expect(skillInstallCommand({ ROVE_INVOKED_AS: "kobe" })).toBe("kobe skill install")
  })
})

describe("skill version / staleness", () => {
  it("parses canonical and legacy skill-version markers", () => {
    expect(parseSkillVersion("<!-- rove-skill-version: 4 -->\n# x")).toBe(4)
    expect(parseSkillVersion("<!-- kobe-skill-version: 3 -->\n# x")).toBe(3)
    expect(parseSkillVersion("no marker here")).toBeNull()
  })

  it("the repo SKILL.md marker is in lockstep with KOBE_SKILL_VERSION", () => {
    // The whole staleness mechanism hinges on these two agreeing — guard it.
    const repoSkill = join(dirname(fileURLToPath(import.meta.url)), "../../../../.agents/skills/kobe/SKILL.md")
    const source = readFileSync(repoSkill, "utf8")
    expect(parseSkillVersion(source)).toBe(KOBE_SKILL_VERSION)
    expect(source).toMatch(/^name: rove$/m)
    expect(source).toContain("${ROVE_TASK_ID:-}")
    expect(source).not.toContain("${KOBE_TASK_ID:-}")
  })

  it("kobeSkillState: absent → not installed, not stale", () => {
    const s = kobeSkillState({ home: tempDir(), cwd: tempDir() })
    expect(s).toMatchObject({ installed: false, stale: false })
  })

  it("kobeSkillState: current version → fresh", () => {
    const cwd = tempDir()
    installSkillUnder(cwd, `<!-- rove-skill-version: ${KOBE_SKILL_VERSION} -->`)
    expect(kobeSkillState({ home: tempDir(), cwd })).toMatchObject({ installed: true, stale: false })
  })

  it("kobeSkillState: older version → stale", () => {
    const cwd = tempDir()
    installSkillUnder(cwd, `<!-- kobe-skill-version: ${KOBE_SKILL_VERSION - 1} -->`)
    expect(kobeSkillState({ home: tempDir(), cwd })).toMatchObject({
      installed: true,
      installedVersion: KOBE_SKILL_VERSION - 1,
      stale: true,
    })
  })

  it("kobeSkillState: a leftover kobe copy is reported beside a current rove one", () => {
    // Agents load every skill directory they find, so the stale `kobe` copy
    // keeps teaching an old `api` surface however green the rove copy is.
    // Reporting the first path found hid it completely.
    const home = tempDir()
    mkdirSync(join(home, ".agents/skills/kobe"), { recursive: true })
    writeFileSync(join(home, ".agents/skills/kobe/SKILL.md"), `<!-- kobe-skill-version: ${KOBE_SKILL_VERSION - 5} -->`)
    // The agent-skills CLI symlinks the agent dir at the shared copy — one
    // file, one warning, not two.
    mkdirSync(join(home, ".claude/skills"), { recursive: true })
    symlinkSync(join(home, ".agents/skills/kobe"), join(home, ".claude/skills/kobe"))
    mkdirSync(join(home, ".agents/skills/rove"), { recursive: true })
    writeFileSync(join(home, ".agents/skills/rove/SKILL.md"), `<!-- rove-skill-version: ${KOBE_SKILL_VERSION} -->`)

    const state = kobeSkillState({ home, cwd: tempDir() })
    expect(state).toMatchObject({ installed: true, installedVersion: KOBE_SKILL_VERSION, stale: false })
    expect(state.legacyCopies).toEqual([
      { path: join(home, ".agents/skills/kobe/SKILL.md"), version: KOBE_SKILL_VERSION - 5 },
    ])
    expect(installedSkillDirs(home)).toEqual([join(home, ".agents/skills/rove"), join(home, ".agents/skills/kobe")])
  })

  it("kobeSkillState: a kobe-only install reports no duplicate — it IS the install", () => {
    const home = tempDir()
    installSkillUnder(home, `<!-- kobe-skill-version: ${KOBE_SKILL_VERSION} -->`, "kobe")
    expect(kobeSkillState({ home, cwd: tempDir() })).toMatchObject({ installed: true, legacyCopies: [] })
  })

  it("kobeSkillState: unstamped install → stale (refresh once)", () => {
    const cwd = tempDir()
    installSkillUnder(cwd, "old skill with no version marker")
    expect(kobeSkillState({ home: tempDir(), cwd })).toMatchObject({
      installed: true,
      installedVersion: null,
      stale: true,
    })
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
