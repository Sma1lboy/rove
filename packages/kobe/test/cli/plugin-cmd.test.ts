import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pluginLogPath } from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
import { loadPluginRegistry } from "@sma1lboy/kobe-daemon/plugins/registry"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sessionMocks = vi.hoisted(() => ({
  openDaemonSession: vi.fn(),
  resolveActiveTaskId: vi.fn(),
}))

vi.mock("../../src/cli/daemon-session.ts", () => sessionMocks)

import { runPluginSubcommand } from "../../src/cli/plugin-cmd.ts"

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function writeManifest(root: string, id: string, extras: string[] = []): void {
  writeFileSync(
    join(root, "rove-plugin.toml"),
    [`id = "${id}"`, 'name = "Workflow"', 'version = "1.2.3"', 'min_rove_version = "0.1.0"', ...extras].join("\n"),
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("plugin command workflow", () => {
  beforeEach(() => {
    sessionMocks.openDaemonSession.mockReset()
    sessionMocks.resolveActiveTaskId.mockReset()
  })

  it("links, inspects, toggles, and unlinks a canonical Rove plugin", async () => {
    const home = tempDir("rove-plugin-cmd-home-")
    const root = tempDir("rove-plugin-cmd-root-")
    vi.stubEnv("ROVE_HOME_DIR", home)
    writeManifest(root, "example.workflow", [
      "[[actions]]",
      'id = "run"',
      'title = "Run workflow"',
      'command = ["true"]',
    ])
    const output: string[] = []
    vi.spyOn(console, "log").mockImplementation((...args) => output.push(args.map(String).join(" ")))

    await runPluginSubcommand(["link", root])
    await runPluginSubcommand(["list"])
    await runPluginSubcommand(["disable", "example.workflow"])
    expect(loadPluginRegistry(home).plugins[0]?.enabled).toBe(false)
    await runPluginSubcommand(["enable", "example.workflow"])
    await runPluginSubcommand(["action", "list", "--plugin", "example.workflow"])
    await runPluginSubcommand(["config-dir", "example.workflow"])
    await runPluginSubcommand(["log", "example.workflow"])
    writeFileSync(pluginLogPath("example.workflow", home), '{"run":1}\n{"run":2}\n')
    await runPluginSubcommand(["log", "example.workflow", "-n", "1"])

    expect(output.join("\n")).toContain("linked example.workflow v1.2.3")
    expect(output.join("\n")).toContain("example.workflow.run  Run workflow")
    expect(output.join("\n")).toContain(join(home, ".kobe", "plugins", "example.workflow", "config"))
    expect(output.join("\n")).toContain("(no runs logged yet)")
    expect(output.join("\n")).toContain('{"run":2}')
    expect(existsSync(join(home, ".kobe", "plugins", "example.workflow", "state"))).toBe(true)

    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    await runPluginSubcommand(["action", "invoke", "example.workflow.run", "extra"])
    expect(exit).toHaveBeenCalledWith(0)
    exit.mockRestore()

    await runPluginSubcommand(["unlink", "example.workflow"])
    expect(loadPluginRegistry(home).plugins).toEqual([])
    expect(existsSync(root)).toBe(true)
    await runPluginSubcommand(["list"])

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    await runPluginSubcommand(["--help"])
    expect(stdout.mock.calls.map((call) => String(call[0])).join("")).toContain("GitHub topic rove-plugin")
  })

  it("resolves dotted plugin ids by longest registered prefix for actions", async () => {
    const home = tempDir("rove-plugin-cmd-home-")
    const rootA = tempDir("rove-plugin-cmd-root-a-")
    const rootB = tempDir("rove-plugin-cmd-root-b-")
    vi.stubEnv("ROVE_HOME_DIR", home)

    // Two plugins whose ids share a prefix: "example" and "example.workflow".
    writeManifest(rootA, "example", ["[[actions]]", 'id = "run"', 'title = "Wrong action"', 'command = ["false"]'])
    writeManifest(rootB, "example.workflow", [
      "[[actions]]",
      'id = "run"',
      'title = "Right action"',
      'command = ["true"]',
    ])

    await runPluginSubcommand(["link", rootA])
    await runPluginSubcommand(["link", rootB])

    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    await runPluginSubcommand(["action", "invoke", "example.workflow.run"])
    expect(exit).toHaveBeenCalledWith(0)
    exit.mockRestore()
  })

  it("opens a pane via qualified id and resolves the active task", async () => {
    const home = tempDir("rove-plugin-cmd-home-")
    const root = tempDir("rove-plugin-cmd-root-")
    vi.stubEnv("ROVE_HOME_DIR", home)
    writeManifest(root, "example", [
      "[[panes]]",
      'id = "logs"',
      'title = "Logs"',
      'command = ["tail", "-f", "log.txt"]',
      'placement = "split"',
    ])

    await runPluginSubcommand(["link", root])

    const client = {
      request: vi.fn().mockResolvedValue(undefined),
    }
    sessionMocks.openDaemonSession.mockResolvedValue({ client, close: vi.fn() })
    sessionMocks.resolveActiveTaskId.mockResolvedValue("task-42")

    const output: string[] = []
    vi.spyOn(console, "log").mockImplementation((...args) => output.push(args.map(String).join(" ")))

    await runPluginSubcommand(["pane", "open", "example.logs"])

    expect(sessionMocks.openDaemonSession).toHaveBeenCalledWith({ mode: "start" })
    expect(sessionMocks.resolveActiveTaskId).toHaveBeenCalledWith(client)
    expect(client.request).toHaveBeenCalledWith(
      "tab.open",
      expect.objectContaining({
        taskId: "task-42",
        title: "Logs",
        placement: "split",
      }),
    )
    expect(output.join("\n")).toContain("opened pane example.logs in task task-42")
  })
})
