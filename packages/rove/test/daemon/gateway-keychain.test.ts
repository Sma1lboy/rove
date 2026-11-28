import {
  GATEWAY_KEYCHAIN_SERVICE,
  type GatewayCredentialDeps,
  defaultProviderKeyEnv,
  deleteGatewayProviderKey,
  describeProviderKeySource,
  getGatewayKeychainKey,
  isGatewayKeychainSupported,
  resolveProviderApiKey,
  setGatewayProviderKey,
  unsupportedKeychainMessage,
} from "@sma1lboy/rove-daemon/gateway/keychain"
import { describe, expect, it } from "vitest"

function fakeCredDeps(
  platform: string,
  env: Record<string, string> = {},
  store: Record<string, string> = {},
): { deps: GatewayCredentialDeps; calls: string[][] } {
  const calls: string[][] = []
  const deps: GatewayCredentialDeps = {
    platform: () => platform,
    env: () => env,
    run(argv) {
      calls.push([...argv])
      const cmd = argv[1]
      const svc = argv[argv.indexOf("-s") + 1] ?? ""
      const acct = argv[argv.indexOf("-a") + 1] ?? ""
      const key = `${svc}::${acct}`
      if (cmd === "add-generic-password") {
        store[key] = argv[argv.indexOf("-w") + 1] ?? ""
        return { stdout: "", exitCode: 0 }
      }
      if (cmd === "find-generic-password") {
        return key in store ? { stdout: `${store[key]}\n`, exitCode: 0 } : { stdout: "", exitCode: 44 }
      }
      if (cmd === "delete-generic-password") {
        const existed = key in store
        delete store[key]
        return { stdout: "", exitCode: existed ? 0 : 44 }
      }
      return { stdout: "", exitCode: 1 }
    },
  }
  return { deps, calls }
}

describe("provider gateway credential isolation", () => {
  it("stores, reads, and deletes keys via macOS security CLI under rove-provider-gateway", () => {
    const { deps, calls } = fakeCredDeps("darwin")
    expect(isGatewayKeychainSupported(deps)).toBe(true)
    expect(setGatewayProviderKey("anthropic-main", "sk-ant-real-123", { deps })).toBe(true)
    expect(getGatewayKeychainKey("anthropic-main", { deps })).toBe("sk-ant-real-123")
    expect(calls[0]?.slice(0, 6)).toEqual([
      "security",
      "add-generic-password",
      "-U",
      "-s",
      GATEWAY_KEYCHAIN_SERVICE,
      "-a",
    ])
    expect(resolveProviderApiKey({ id: "anthropic-main" }, deps)).toEqual({
      key: "sk-ant-real-123",
      source: "keychain",
    })
    expect(describeProviderKeySource({ id: "anthropic-main" }, deps)).toBe("keychain")

    expect(deleteGatewayProviderKey("anthropic-main", { deps })).toBe(true)
    expect(getGatewayKeychainKey("anthropic-main", { deps })).toBeNull()
    expect(describeProviderKeySource({ id: "anthropic-main" }, deps)).toBe("none")
  })

  it("falls back to daemon env variables on Linux/Windows without touching security CLI", () => {
    const { deps, calls } = fakeCredDeps("linux", {
      ROVE_GATEWAY_KEY_OPENROUTER: "sk-or-env-999",
      CUSTOM_PROVIDER_KEY: "sk-custom-42",
    })
    expect(isGatewayKeychainSupported(deps)).toBe(false)
    expect(setGatewayProviderKey("openrouter", "sk-ignored", { deps })).toBe(false)
    expect(calls).toEqual([])

    expect(defaultProviderKeyEnv("open-router")).toBe("ROVE_GATEWAY_KEY_OPEN_ROUTER")
    expect(resolveProviderApiKey({ id: "openrouter" }, deps)).toEqual({
      key: "sk-or-env-999",
      source: "env",
    })
    expect(resolveProviderApiKey({ id: "custom", apiKeyEnv: "CUSTOM_PROVIDER_KEY" }, deps)).toEqual({
      key: "sk-custom-42",
      source: "env",
    })
    expect(unsupportedKeychainMessage("openrouter")).toContain("ROVE_GATEWAY_KEY_OPENROUTER")
  })
})
