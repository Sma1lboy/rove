import { parseProviderGatewayConfig, validateProviderInput } from "@sma1lboy/rove-daemon/gateway/config"
import { describe, expect, it } from "vitest"

describe("provider gateway config", () => {
  it("defaults to opt-in disabled on 127.0.0.1 with headless injection", () => {
    const { config, warnings } = parseProviderGatewayConfig(undefined)
    expect(warnings).toEqual([])
    expect(config.enabled).toBe(false)
    expect(config.host).toBe("127.0.0.1")
    expect(config.port).toBe(0)
    expect(config.injectMode).toBe("headless")
    expect(config.providers).toEqual([])
  })

  it("forces non-loopback bind hosts back to 127.0.0.1 with a warning", () => {
    const { config, warnings } = parseProviderGatewayConfig({
      enabled: true,
      host: "0.0.0.0",
      providers: [],
    })
    expect(config.host).toBe("127.0.0.1")
    expect(warnings[0]).toMatch(/literal loopback IP/)
  })

  it("rejects plaintext credential fields and strips auth headers from extraHeaders", () => {
    const { config, warnings } = parseProviderGatewayConfig({
      enabled: true,
      providers: [
        {
          id: "bad-secret",
          protocol: "anthropic",
          baseUrl: "https://api.anthropic.com",
          models: ["claude-*"],
          apiKey: "sk-ant-never-store-here",
        },
        {
          id: "clean",
          protocol: "openai",
          baseUrl: "https://api.example.com/v1",
          models: ["gpt-*"],
          extraHeaders: {
            Authorization: "Bearer sk-leak",
            "x-api-key": "sk-leak",
            "HTTP-Referer": "https://rove.run",
          },
        },
      ],
    })
    expect(config.providers.map((p) => p.id)).toEqual(["clean"])
    expect(config.providers[0]?.extraHeaders).toEqual({ "HTTP-Referer": "https://rove.run" })
    expect(warnings.some((w) => w.includes("forbidden credential field"))).toBe(true)
    expect(warnings.some((w) => w.includes("forbidden auth header"))).toBe(true)
  })

  it("refuses plain http:// for remote upstreams while permitting loopback http://", () => {
    const remoteHttp = validateProviderInput({
      id: "remote-http",
      protocol: "openai",
      baseUrl: "http://api.example.com/v1",
      models: ["*"],
    })
    expect(remoteHttp.ok).toBe(false)

    const localHttp = validateProviderInput({
      id: "local-ollama",
      protocol: "openai",
      baseUrl: "http://127.0.0.1:11434/v1/",
      models: ["llama-*"],
    })
    expect(localHttp.ok).toBe(true)
    expect(localHttp.ok && localHttp.provider.baseUrl).toBe("http://127.0.0.1:11434/v1")
  })
})
