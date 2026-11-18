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

  test.each([
    ["api", "usage: rove api"],
    ["config", "Usage: rove config"],
    ["daemon", "Usage: rove daemon"],
    ["doctor", "Usage: rove doctor"],
    ["export", "Usage: rove export"],
    ["feedback", "Usage: rove feedback"],
    ["plugin", "usage: rove plugin"],
    ["repo", "Usage: rove repo"],
    ["reset", "Usage: rove reset"],
    ["skill", "usage: rove skill"],
    ["theme", "Usage: rove theme"],
    ["update", "Usage: rove update"],
  ])("%s --help names the invoked rove executable", (command, expected) => {
    const result = runRove([command, "--help"], behavior)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(expected)
  })

  test("ROVE_HOME_DIR resolves the canonical config path", () => {
    const result = runRove(["config", "--path"], {
      ...behavior,
      env: { ...behavior.env, ROVE_HOME_DIR: join(behavior.home, "rove-home") },
    })
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe(join(behavior.home, "rove-home", ".config", "rove", "state.json"))
  })

  test("the public wrapper migrates client state without racing daemon-owned stores", () => {
    const migrationHome = join(behavior.home, "migration-home")
    mkdirSync(preRenameStateDir(migrationHome), { recursive: true })
    mkdirSync(join(preRenameConfigDir(migrationHome)), { recursive: true })
    mkdirSync(join(migrationHome, ".rove"), { recursive: true })
    mkdirSync(join(preRenameStateDir(migrationHome), "settings"), { recursive: true })
    writeFileSync(join(preRenameStateDir(migrationHome), "settings", "keybindings.yaml"), "legacy keys")
    writeFileSync(join(preRenameStateDir(migrationHome), "tasks.json"), "daemon tasks")
    writeFileSync(join(preRenameConfigDir(migrationHome), "state.json"), "legacy prefs")
    writeFileSync(join(migrationHome, ".rove", "issues.json"), "canonical issues")
    writeFileSync(join(preRenameStateDir(migrationHome), "issues.json"), "legacy issues")
    const result = runRove(["config", "--path"], {
      ...behavior,
      env: { ...behavior.env, ROVE_HOME_DIR: migrationHome },
    })
    expect(result.code).toBe(0)
    expect(readFileSync(join(migrationHome, ".rove", "settings", "keybindings.yaml"), "utf8")).toBe("legacy keys")
    expect(readFileSync(join(migrationHome, ".config", "rove", "state.json"), "utf8")).toBe("legacy prefs")
    expect(readFileSync(join(migrationHome, ".rove", "issues.json"), "utf8")).toBe("canonical issues")
    expect(existsSync(join(migrationHome, ".rove", "tasks.json"))).toBe(false)
    expect(existsSync(join(migrationHome, ".rove", "worktrees"))).toBe(false)
  })
})
