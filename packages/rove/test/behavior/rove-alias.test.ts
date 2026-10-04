import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { preRenameConfigDir, preRenameStateDir } from "@sma1lboy/rove-daemon/daemon/pre-rename-runtime"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { CURRENT_VERSION } from "../../src/version.ts"
import { type BehaviorEnv, makeBehaviorEnv, runRove } from "./harness.ts"

describe("rove CLI compatibility entry", () => {
  let behavior: BehaviorEnv

  beforeAll(async () => {
    behavior = await makeBehaviorEnv()
  })

  afterAll(async () => {
    await behavior.dispose()
  })

  test("reports the rove command name for version and help", () => {
    const version = runRove(["--version"], behavior)
    expect(version.code).toBe(0)
    expect(version.stdout.trim()).toBe(`rove ${CURRENT_VERSION}`)

    const help = runRove(["--help"], behavior)
    expect(help.code).toBe(0)
    expect(help.stdout).toContain("Usage: rove [command] [options]")
  })

  test("generates completions for rove rather than the legacy alias", () => {
    const result = runRove(["completions", "bash"], behavior)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("complete -F _rove rove")
  })

  test("subcommand help consistently names the invoked rove executable", () => {
    const cases: ReadonlyArray<readonly [readonly string[], string]> = [
      [["api", "--help"], "usage: rove api"],
      [["config", "--help"], "Usage: rove config"],
      [["daemon", "--help"], "Usage: rove daemon"],
      [["doctor", "--help"], "Usage: rove doctor"],
      [["export", "--help"], "Usage: rove export"],
      [["feedback", "--help"], "Usage: rove feedback"],
      [["plugin", "--help"], "usage: rove plugin"],
      [["repo", "--help"], "Usage: rove repo"],
      [["reset", "--help"], "Usage: rove reset"],
      [["skill", "--help"], "usage: rove skill"],
      [["theme", "--help"], "Usage: rove theme"],
      [["update", "--help"], "Usage: rove update"],
    ]

    for (const [args, expected] of cases) {
      const result = runRove(args, behavior)
      expect(result.code, args.join(" ")).toBe(0)
      expect(result.stdout, args.join(" ")).toContain(expected)
    }
  })

  test("ROVE_HOME_DIR wins and resolves the canonical config path", () => {
    const originalRoveHome = behavior.env.ROVE_HOME_DIR
    const originalLegacyHome = behavior.env.ROVE_HOME_DIR
    behavior.env.ROVE_HOME_DIR = join(behavior.home, "legacy-home")
    behavior.env.ROVE_HOME_DIR = join(behavior.home, "rove-home")
    try {
      const result = runRove(["config", "--path"], behavior)
      expect(result.code).toBe(0)
      expect(result.stdout.trim()).toBe(join(behavior.home, "rove-home", ".config", "rove", "state.json"))
    } finally {
      behavior.env.ROVE_HOME_DIR = originalRoveHome
      behavior.env.ROVE_HOME_DIR = originalLegacyHome
    }
  })

  test("the public wrapper migrates client state without racing daemon-owned stores", () => {
    const originalRoveHome = behavior.env.ROVE_HOME_DIR
    const originalLegacyHome = behavior.env.ROVE_HOME_DIR
    const migrationHome = join(behavior.home, "migration-home")
    behavior.env.ROVE_HOME_DIR = migrationHome
    behavior.env.ROVE_HOME_DIR = migrationHome
    mkdirSync(preRenameStateDir(migrationHome), { recursive: true })
    mkdirSync(join(preRenameConfigDir(migrationHome)), { recursive: true })
    mkdirSync(join(migrationHome, ".rove"), { recursive: true })
    mkdirSync(join(preRenameStateDir(migrationHome), "settings"), { recursive: true })
    writeFileSync(join(preRenameStateDir(migrationHome), "settings", "keybindings.yaml"), "legacy keys")
    writeFileSync(join(preRenameStateDir(migrationHome), "tasks.json"), "daemon tasks")
    writeFileSync(join(preRenameConfigDir(migrationHome), "state.json"), "legacy prefs")
    writeFileSync(join(migrationHome, ".rove", "issues.json"), "canonical issues")
    writeFileSync(join(preRenameStateDir(migrationHome), "issues.json"), "legacy issues")
    try {
      const result = runRove(["config", "--path"], behavior)
      expect(result.code).toBe(0)
      expect(readFileSync(join(migrationHome, ".rove", "settings", "keybindings.yaml"), "utf8")).toBe("legacy keys")
      expect(readFileSync(join(migrationHome, ".config", "rove", "state.json"), "utf8")).toBe("legacy prefs")
      expect(readFileSync(join(migrationHome, ".rove", "issues.json"), "utf8")).toBe("canonical issues")
      expect(existsSync(join(migrationHome, ".rove", "tasks.json"))).toBe(false)
      expect(existsSync(join(migrationHome, ".rove", "worktrees"))).toBe(false)
    } finally {
      behavior.env.ROVE_HOME_DIR = originalRoveHome
      behavior.env.ROVE_HOME_DIR = originalLegacyHome
    }
  })
})
