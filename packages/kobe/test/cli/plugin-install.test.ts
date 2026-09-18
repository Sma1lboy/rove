import { EventEmitter } from "node:events"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pluginConfigDir, pluginStateDir, pluginsRootDir } from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
import { loadPluginRegistry, savePluginRegistry } from "@sma1lboy/kobe-daemon/plugins/registry"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, spawn: mocks.spawn }
})

/**
 * Stand-in for a spawned child: install awaits the `close` event, so the fake
 * only has to emit one (with no pipes — these steps produce no output).
 */
function fakeChild(status: number): EventEmitter {
  const child = new EventEmitter() as EventEmitter & { stdout: null; stderr: null }
  child.stdout = null
  child.stderr = null
  setImmediate(() => child.emit("close", status))
  return child
}

import { installPlugin, linkPlugin, preparePluginInstall } from "../../src/cli/plugin-install.ts"

const dirs: string[] = []

function pluginDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rove-plugin-install-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  mocks.spawn.mockReset()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("plugin manifest diagnostics", () => {
  it("preserves parser errors instead of reporting an existing manifest as missing", () => {
    const dir = pluginDir()
    writeFileSync(join(dir, "rove-plugin.toml"), 'id = "broken"\n')

    expect(() => linkPlugin(dir)).toThrow(/rove-plugin\.toml: `name` must be a non-empty string/)
  })

  it("labels parser errors with the legacy manifest filename actually read", () => {
    const dir = pluginDir()
    writeFileSync(join(dir, "kobe-plugin.toml"), 'id = "broken"\n')

    expect(() => linkPlugin(dir)).toThrow(/kobe-plugin\.toml: `name` must be a non-empty string/)
  })

  it("names both accepted files when no manifest exists", () => {
    expect(() => linkPlugin(pluginDir())).toThrow(/no rove-plugin\.toml or kobe-plugin\.toml found/)
  })

  it("registers a canonical local plugin and creates its persistent directories", () => {
    const home = pluginDir()
    const root = pluginDir()
    vi.stubEnv("ROVE_HOME_DIR", home)
    writeFileSync(
      join(root, "rove-plugin.toml"),
      'id = "linked.plugin"\nname = "Linked"\nversion = "1.0.0"\nmin_rove_version = "0.1.0"',
    )

    linkPlugin(root)

    expect(loadPluginRegistry(home).plugins).toMatchObject([
      { id: "linked.plugin", root, enabled: true, version: "1.0.0", source: { kind: "link" } },
    ])
    expect(existsSync(pluginConfigDir("linked.plugin", home))).toBe(true)
    expect(existsSync(pluginStateDir("linked.plugin", home))).toBe(true)
  })

  it("rejects incompatible versions and collisions with managed installs", () => {
    const home = pluginDir()
    const root = pluginDir()
    vi.stubEnv("ROVE_HOME_DIR", home)
    writeFileSync(
      join(root, "rove-plugin.toml"),
      'id = "linked.plugin"\nname = "Linked"\nversion = "1.0.0"\nmin_rove_version = "99.0.0"',
    )
    expect(() => linkPlugin(root)).toThrow(/requires Rove >= 99\.0\.0/)

    writeFileSync(
      join(root, "rove-plugin.toml"),
      'id = "linked.plugin"\nname = "Linked"\nversion = "1.0.0"\nmin_rove_version = "0.1.0"',
    )
    savePluginRegistry(
      {
        plugins: [
          {
            id: "linked.plugin",
            source: { kind: "github", spec: "owner/repo" },
            root: "/managed",
            enabled: true,
            version: "0.9.0",
            installedAt: 1,
          },
        ],
      },
      home,
    )
    expect(() => linkPlugin(root)).toThrow(/installed from GitHub; uninstall it before linking/)
  })

  it("installs a canonical manifest from a managed GitHub checkout", async () => {
    const home = pluginDir()
    vi.stubEnv("ROVE_HOME_DIR", home)
    vi.spyOn(console, "log").mockImplementation(() => {})
    mocks.spawn.mockImplementation((command: string, args: string[]) => {
      expect(command).toBe("git")
      const checkout = args.at(-1) as string
      writeFileSync(
        join(checkout, "rove-plugin.toml"),
        'id = "managed.plugin"\nname = "Managed"\nversion = "2.0.0"\nmin_rove_version = "0.1.0"',
      )
      return fakeChild(0)
    })

    await expect(installPlugin("owner/repo", { yes: true })).resolves.toBe("managed.plugin")

    const [entry] = loadPluginRegistry(home).plugins
    expect(entry).toMatchObject({
      id: "managed.plugin",
      source: { kind: "github", spec: "owner/repo" },
      enabled: true,
      version: "2.0.0",
    })
    expect(existsSync(join(entry?.root ?? "", "rove-plugin.toml"))).toBe(true)
  })

  it("stages the clone beside the destination so the move never crosses devices", async () => {
    // Regression: staging in os.tmpdir() made the final rename() fail with
    // EXDEV wherever /tmp is its own filesystem (tmpfs, WSL2).
    const home = pluginDir()
    vi.stubEnv("ROVE_HOME_DIR", home)
    vi.spyOn(console, "log").mockImplementation(() => {})
    const cloneTargets: string[] = []
    mocks.spawn.mockImplementation((_command: string, args: string[]) => {
      const checkout = args.at(-1) as string
      cloneTargets.push(checkout)
      writeFileSync(
        join(checkout, "rove-plugin.toml"),
        'id = "managed.plugin"\nname = "Managed"\nversion = "2.0.0"\nmin_rove_version = "0.1.0"',
      )
      return fakeChild(0)
    })

    await installPlugin("owner/repo", { yes: true })

    expect(cloneTargets).toHaveLength(1)
    expect(cloneTargets[0]?.startsWith(`${pluginsRootDir(home)}/`)).toBe(true)
    expect(existsSync(cloneTargets[0] as string)).toBe(false)
  })

  it("rejects a build that switches from the previewed legacy manifest to a canonical one", async () => {
    const home = pluginDir()
    vi.stubEnv("ROVE_HOME_DIR", home)
    vi.spyOn(console, "log").mockImplementation(() => {})
    mocks.spawn.mockImplementation((command: string, args: string[], opts?: { cwd?: string }) => {
      if (command === "git") {
        const checkout = args.at(-1) as string
        writeFileSync(
          join(checkout, "kobe-plugin.toml"),
          [
            'id = "managed.plugin"',
            'name = "Managed"',
            'version = "2.0.0"',
            'min_kobe_version = "0.1.0"',
            "[[build]]",
            'command = ["build-plugin"]',
          ].join("\n"),
        )
        return fakeChild(0)
      }
      if (command === "build-plugin" && opts?.cwd) {
        writeFileSync(
          join(opts.cwd, "rove-plugin.toml"),
          [
            'id = "managed.plugin"',
            'name = "Changed after preview"',
            'version = "9.9.9"',
            'min_rove_version = "0.1.0"',
            "[[startup]]",
            'command = ["hidden-hook"]',
          ].join("\n"),
        )
        return fakeChild(0)
      }
      return fakeChild(1)
    })

    await expect(installPlugin("owner/repo", { yes: true })).rejects.toThrow(/manifest changed during build/)
    expect(loadPluginRegistry(home).plugins).toEqual([])
  })
})

/**
 * The install is two-phased so the confirmation gate is a real one: a plugin's
 * `[[build]]` is arbitrary code, and `docs/PLUGIN-AUTHORING.md` promises every
 * command is previewed before any of it runs. The TUI's Marketplace section
 * shows `preview.commands` in a dialog and only then calls `commit()`, so the
 * property those two surfaces both depend on is tested here once.
 */
describe("staged install", () => {
  const MANIFEST = [
    'id = "staged.plugin"',
    'name = "Staged"',
    'version = "3.0.0"',
    'description = "does a thing"',
    'min_rove_version = "0.1.0"',
    "[[build]]",
    'command = ["build-plugin", "--release"]',
    "[[events]]",
    'on = "task.created"',
    'command = ["notify"]',
  ].join("\n")

  /** git writes the manifest; anything else counts as a command that RAN. */
  function stageClone(ran: string[]): void {
    mocks.spawn.mockImplementation((command: string, args: string[]) => {
      if (command !== "git") {
        ran.push(command)
        return fakeChild(0)
      }
      writeFileSync(join(args.at(-1) as string, "rove-plugin.toml"), MANIFEST)
      return fakeChild(0)
    })
  }

  it("previews every declared command without running any of them", async () => {
    const home = pluginDir()
    vi.stubEnv("ROVE_HOME_DIR", home)
    const ran: string[] = []
    stageClone(ran)

    const prepared = await preparePluginInstall("owner/repo")

    expect(prepared.preview).toMatchObject({
      id: "staged.plugin",
      name: "Staged",
      version: "3.0.0",
      description: "does a thing",
      source: "github.com/owner/repo",
    })
    expect(prepared.preview.commands).toEqual(["build: build-plugin --release", "on task.created: notify"])
    // The gate: nothing but git has run, and nothing is registered yet.
    expect(ran).toEqual([])
    expect(loadPluginRegistry(home).plugins).toEqual([])

    prepared.discard()
    expect(ran).toEqual([])
    expect(loadPluginRegistry(home).plugins).toEqual([])
  })

  it("runs the build and registers only once commit is called", async () => {
    const home = pluginDir()
    vi.stubEnv("ROVE_HOME_DIR", home)
    const ran: string[] = []
    stageClone(ran)

    const prepared = await preparePluginInstall("owner/repo")
    await expect(prepared.commit()).resolves.toBe("staged.plugin")

    expect(ran).toEqual(["build-plugin"])
    expect(loadPluginRegistry(home).plugins).toMatchObject([{ id: "staged.plugin", version: "3.0.0", enabled: true }])
  })

  it("leaves nothing staged behind when the clone finds no manifest", async () => {
    const home = pluginDir()
    vi.stubEnv("ROVE_HOME_DIR", home)
    mocks.spawn.mockImplementation(() => fakeChild(0))

    await expect(preparePluginInstall("owner/repo")).rejects.toThrow(/no rove-plugin\.toml or kobe-plugin\.toml/)
    expect(readdirSync(pluginsRootDir(home)).filter((e) => e.startsWith(".staging-"))).toEqual([])
  })
})
