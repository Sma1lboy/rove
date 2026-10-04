import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ClaudeHookAdapter, claudeSettingsPath } from "../../src/engine/claude-code-local/hook-adapter.ts"
import { trustClaudeWorktree } from "../../src/engine/claude-code-local/trust.ts"
import { CodexHookAdapter, codexHooksPath } from "../../src/engine/codex-local/hook-adapter.ts"
import { trustCodexWorktree } from "../../src/engine/codex-local/trust.ts"
import { kimiTrustFilePath, trustKimiWorktree } from "../../src/engine/kimi-local/trust.ts"

const fixture = vi.hoisted(() => ({ home: "" }))
vi.mock("node:os", async (importActual) => {
  const actual = await importActual<typeof import("node:os")>()
  return { ...actual, homedir: () => fixture.home }
})

let home: string
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "rove-config-profiles-"))
  fixture.home = home
  vi.stubEnv("ROVE_HOME_DIR", path.join(home, "rove"))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("trust config profiles", () => {
  it.each([
    { env: "CLAUDE_CONFIG_DIR", dir: ".claude", trust: trustClaudeWorktree, file: ".claude.json" },
    { env: "CODEX_HOME", dir: ".codex", trust: trustCodexWorktree, file: "config.toml" },
    { env: "KIMI_CODE_HOME", dir: ".kimi-code", trust: trustKimiWorktree, file: "workspace-trust" },
  ])("isolates $env across profiles, defaults and injected home", ({ env, dir, trust, file }) => {
    const profileA = path.join(home, "a")
    const profileB = path.join(home, "b")
    vi.stubEnv(env, profileA)
    trust("/fixture/a")
    expect(fs.existsSync(path.join(profileA, file))).toBe(true)
    expect(fs.existsSync(path.join(home, dir))).toBe(false)
    expect(fs.existsSync(path.join(home, ".claude.json"))).toBe(false)
    const snapshotA = () => {
      const target = path.join(profileA, file)
      return fs.statSync(target).isDirectory()
        ? fs.readdirSync(target).map((entry) => [entry, fs.readFileSync(path.join(target, entry), "utf8")])
        : fs.readFileSync(target, "utf8")
    }
    const beforeA = snapshotA()
    vi.stubEnv(env, `  ${profileB}  `)
    trust("/fixture/b")
    expect(fs.existsSync(path.join(profileB, file))).toBe(true)
    expect(snapshotA()).toEqual(beforeA)
    const injected = path.join(home, "injected")
    fs.mkdirSync(injected)
    trust("/fixture/injected", injected)
    const defaultFile = (base: string) => path.join(base, ...(env === "CLAUDE_CONFIG_DIR" ? [file] : [dir, file]))
    expect(fs.existsSync(defaultFile(injected))).toBe(true)
    vi.stubEnv(env, " \t ")
    trust("/fixture/default")
    expect(fs.existsSync(defaultFile(home))).toBe(true)
  })

  it("keeps explicit Kimi path lookup isolated from the live profile", () => {
    vi.stubEnv("KIMI_CODE_HOME", path.join(home, "profile"))
    expect(kimiTrustFilePath("/fixture/a", home)).toContain(path.join(home, ".kimi-code"))
    expect(kimiTrustFilePath("/fixture/a")).toContain(path.join(home, "profile"))
  })
})

describe("hook config profiles", () => {
  it.each([
    {
      env: "CLAUDE_CONFIG_DIR",
      dir: ".claude",
      file: "settings.json",
      resolve: claudeSettingsPath,
      adapter: new ClaudeHookAdapter(),
    },
    { env: "CODEX_HOME", dir: ".codex", file: "hooks.json", resolve: codexHooksPath, adapter: new CodexHookAdapter() },
  ])("installs and uninstalls only the selected $env profile", async ({ env, dir, file, resolve, adapter }) => {
    const baseline =
      '{ "user": { "keep": true }, "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "echo user" }] }] } }\n'
    for (const name of [dir, "a", "b"]) {
      fs.mkdirSync(path.join(home, name))
      fs.writeFileSync(path.join(home, name, file), baseline)
    }
    vi.stubEnv(env, path.join(home, "a"))
    expect(resolve()).toBe(path.join(home, "a", file))
    await adapter.installActivityHooks(adapter.globalSettingsPath())
    const installedA = fs.readFileSync(resolve(), "utf8")
    await adapter.installActivityHooks(adapter.globalSettingsPath())
    expect(fs.readFileSync(resolve(), "utf8")).toBe(installedA)
    vi.stubEnv(env, path.join(home, "b"))
    await adapter.installActivityHooks(adapter.globalSettingsPath())
    await adapter.removeActivityHooks(adapter.globalSettingsPath())
    expect(JSON.parse(fs.readFileSync(resolve(), "utf8"))).toEqual(JSON.parse(baseline))
    expect(fs.readFileSync(path.join(home, "a", file), "utf8")).toBe(installedA)
    expect(fs.readFileSync(path.join(home, dir, file), "utf8")).toBe(baseline)
    vi.stubEnv(env, " \t ")
    expect(resolve()).toBe(path.join(home, dir, file))
  })
})
