import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildEngineSessionLaunch } from "@sma1lboy/rove-core/engine/session-launch.ts"
import { loadProviderGatewayConfig } from "@sma1lboy/rove-core/state/provider-gateway.ts"
import type { GatewayCredentialDeps } from "@sma1lboy/rove-daemon/gateway/keychain"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runGatewaySubcommand } from "../../src/cli/gateway-cmd.ts"

let tempHome = ""
const prevHome = process.env.ROVE_HOME_DIR

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "rove-gw-cli-"))
  process.env.ROVE_HOME_DIR = tempHome
})

afterEach(() => {
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = prevHome
  rmSync(tempHome, { recursive: true, force: true })
})

function captureCli(platform = "darwin", keychainStore: Record<string, string> = {}) {
  let out = ""
  let err = ""
  let exitCode: number | null = null
  const credDeps: GatewayCredentialDeps = {
    platform: () => platform,
    env: () => ({}),
    run(argv) {
      const cmd = argv[1]
      const acct = argv[argv.indexOf("-a") + 1] ?? ""
      if (cmd === "add-generic-password") {
        keychainStore[acct] = argv[argv.indexOf("-w") + 1] ?? ""
        return { stdout: "", exitCode: 0 }
      }
      if (cmd === "find-generic-password") {
        return acct in keychainStore
          ? { stdout: `${keychainStore[acct]}\n`, exitCode: 0 }
          : { stdout: "", exitCode: 44 }
      }
      if (cmd === "delete-generic-password") {
        const had = acct in keychainStore
        delete keychainStore[acct]
        return { stdout: "", exitCode: had ? 0 : 44 }
      }
      return { stdout: "", exitCode: 1 }
    },
  }
  const run = async (argv: readonly string[], secretInput = "") => {
    out = ""
    err = ""
    exitCode = null
    try {
      await runGatewaySubcommand(argv, {
        stdout: {
          write: (s: string) => {
            out += s
            return true
          },
        },
        stderr: {
          write: (s: string) => {
            err += s
            return true
          },
        },
        exit: (code: number) => {
          exitCode = code
          throw new Error(`EXIT:${code}`)
        },
        credentialDeps: credDeps,
        readSecret: async () => secretInput,
        daemonRequest: async () => {
          throw new Error("offline")
        },
      })
    } catch (e) {
      if (!(e instanceof Error && e.message.startsWith("EXIT:"))) throw e
    }
    return { out, err, exitCode }
  }
  return { run, keychainStore }
}

describe("rove gateway CLI", () => {
  it("adds, lists, enables, disables, stores Keychain keys via stdin/prompt, and rejects argv keys", async () => {
    const cli = captureCli("darwin")

    const badArgvKey = await cli.run([
      "add",
      "primary",
      "--protocol",
      "anthropic",
      "--base-url",
      "https://api.anthropic.com",
      "--models",
      "claude-*",
      "--api-key",
      "sk-ant-bad",
    ])
    expect(badArgvKey.exitCode).toBe(2)
    expect(badArgvKey.err).toContain("never pass API keys on the command line")

    const added = await cli.run([
      "add",
      "primary",
      "--protocol",
      "anthropic",
      "--base-url",
      "https://api.anthropic.com",
      "--models",
      "claude-*",
      "--priority",
      "10",
    ])
    expect(added.exitCode).toBeNull()
    expect(loadProviderGatewayConfig().providers).toHaveLength(1)

    const stored = await cli.run(["set-key", "primary", "--stdin"], "sk-ant-real-key")
    expect(stored.exitCode).toBeNull()
    expect(cli.keychainStore["provider:primary"]).toBe("sk-ant-real-key")
    expect(stored.out).not.toContain("sk-ant-real-key")

    const enabled = await cli.run(["enable", "--port", "4312", "--inject", "headless"])
    expect(enabled.exitCode).toBeNull()
    expect(loadProviderGatewayConfig()).toMatchObject({ enabled: true, port: 4312, injectMode: "headless" })

    const listed = await cli.run(["list"])
    expect(listed.out).toContain("primary")
    expect(listed.out).toContain("key=keychain")
    expect(listed.out).not.toContain("sk-ant-real-key")

    const removed = await cli.run(["remove", "primary", "--purge-key"])
    expect(removed.exitCode).toBeNull()
    expect(cli.keychainStore["provider:primary"]).toBeUndefined()
  })

  it("explains the env-var fallback clearly on Linux without writing any file", async () => {
    const cli = captureCli("linux")
    const res = await cli.run(["set-key", "openrouter"], "sk-or-123")
    expect(res.exitCode).toBe(1)
    expect(res.err).toContain("ROVE_GATEWAY_KEY_OPENROUTER")
    expect(res.err).toContain("never write API keys to plain files")
  })
})

describe("session launch gateway env injection", () => {
  it("injects only engine-owned loopback URL and placeholder token when active, leaving BYOS launches untouched", () => {
    const untouched = buildEngineSessionLaunch({
      task: { id: "t1", kind: "task", vendor: "claude" },
      worktreePath: tempHome,
      shell: "/bin/sh",
      argv: ["claude"],
      promptIntent: { kind: "none" },
    })
    expect(untouched.command[2]).not.toContain("ANTHROPIC_BASE_URL")
    expect(untouched.command[2]).not.toContain("ANTHROPIC_API_KEY")

    const claudeGw = buildEngineSessionLaunch({
      task: { id: "t1", kind: "task", vendor: "claude" },
      worktreePath: tempHome,
      shell: "/bin/sh",
      argv: ["claude"],
      promptIntent: { kind: "none" },
      gateway: { baseUrl: "http://127.0.0.1:41234", token: "rove-gw-placeholder" },
    })
    expect(claudeGw.command[2]).toContain("ANTHROPIC_BASE_URL='http://127.0.0.1:41234'")
    expect(claudeGw.command[2]).toContain("ANTHROPIC_API_KEY='rove-gw-placeholder'")

    const codexGw = buildEngineSessionLaunch({
      task: { id: "t2", kind: "task", vendor: "codex" },
      worktreePath: tempHome,
      shell: "/bin/sh",
      argv: ["codex"],
      promptIntent: { kind: "none" },
      gateway: { baseUrl: "http://127.0.0.1:41234", token: "rove-gw-placeholder" },
    })
    expect(codexGw.command[2]).toContain("OPENAI_BASE_URL='http://127.0.0.1:41234/v1'")
    expect(codexGw.command[2]).toContain("OPENAI_API_KEY='rove-gw-placeholder'")
  })
})
