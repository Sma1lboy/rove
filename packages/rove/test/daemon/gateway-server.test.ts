import { type Server, createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { ProviderGatewayController } from "@sma1lboy/rove-daemon/gateway/controller"
import type { GatewayCredentialDeps } from "@sma1lboy/rove-daemon/gateway/keychain"
import { type ProviderGatewayHandle, startProviderGateway } from "@sma1lboy/rove-daemon/gateway/server"
import type { GatewayLogEvent, ProviderGatewayConfig } from "@sma1lboy/rove-daemon/gateway/types"
import { afterEach, describe, expect, it } from "vitest"
import { dispatch, fakeCtx } from "./handler-test-context.ts"

const openServers: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  while (openServers.length > 0) {
    await openServers.pop()?.close()
  }
})

async function startMockUpstream(
  handler: (req: {
    method: string
    url: string
    headers: Record<string, string | string[] | undefined>
    body: string
  }) => {
    status: number
    headers?: Record<string, string>
    body: string
  },
): Promise<{
  url: string
  requests: Array<{ url: string; headers: Record<string, string | string[] | undefined>; body: string }>
}> {
  const requests: Array<{ url: string; headers: Record<string, string | string[] | undefined>; body: string }> = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8")
      const entry = { method: req.method ?? "POST", url: req.url ?? "/", headers: req.headers, body }
      requests.push({ url: entry.url, headers: entry.headers, body: entry.body })
      const reply = handler(entry)
      res.writeHead(reply.status, { "content-type": "application/json", ...(reply.headers ?? {}) })
      res.end(reply.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  openServers.push({ close: () => new Promise<void>((r) => server.close(() => r())) })
  return { url: `http://127.0.0.1:${port}`, requests }
}

function credDepsWithKeys(keys: Record<string, string>): GatewayCredentialDeps {
  return {
    platform: () => "darwin",
    env: () => ({}),
    run(argv) {
      const acct = argv[argv.indexOf("-a") + 1] ?? ""
      const providerId = acct.replace(/^provider:/, "")
      const secret = keys[providerId]
      return secret ? { stdout: `${secret}\n`, exitCode: 0 } : { stdout: "", exitCode: 44 }
    },
  }
}

async function startGw(config: ProviderGatewayConfig, keys: Record<string, string>, logs: GatewayLogEvent[] = []) {
  const gw: ProviderGatewayHandle = await startProviderGateway({
    config,
    credentialDeps: credDepsWithKeys(keys),
    onLog: (e) => logs.push(e),
  })
  openServers.push({ close: () => gw.close() })
  return gw
}

describe("local loopback provider gateway server", () => {
  it("enforces loopback binding and requires the per-daemon token on every route", async () => {
    const gw = await startGw(
      {
        enabled: true,
        host: "127.0.0.1",
        port: 0,
        injectMode: "headless",
        cooldownMs: 30_000,
        maxCooldownMs: 60_000,
        requestTimeoutMs: 10_000,
        providers: [],
      },
      {},
    )
    const token = gw.sessionEnv().token as string
    expect(gw.baseUrl.startsWith("http://127.0.0.1:")).toBe(true)
    expect(token.startsWith("rove-gw-")).toBe(true)

    const unauthHealth = await fetch(`${gw.baseUrl}/health`)
    expect(unauthHealth.status).toBe(401)

    const wrongToken = await fetch(`${gw.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "wrong-token" },
      body: JSON.stringify({ model: "m", messages: [] }),
    })
    expect(wrongToken.status).toBe(401)

    const authedHealth = await fetch(`${gw.baseUrl}/health`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(authedHealth.status).toBe(200)
    const healthJson = (await authedHealth.json()) as { ok: boolean; status: Record<string, unknown> }
    expect(healthJson.ok).toBe(true)
    expect(JSON.stringify(healthJson)).not.toContain(token)
  })

  it("passes Anthropic Messages directly with Keychain credential isolation and fails over to OpenAI translation on 429", async () => {
    const primaryKey = "sk-ant-secret-primary-999"
    const fallbackKey = "sk-openai-secret-fallback-888"
    let primaryStatus = 200

    const primary = await startMockUpstream(() =>
      primaryStatus === 200
        ? {
            status: 200,
            body: JSON.stringify({
              id: "msg_primary",
              type: "message",
              role: "assistant",
              model: "claude-sonnet-4-5",
              content: [{ type: "text", text: "from primary" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 4, output_tokens: 2 },
            }),
          }
        : {
            status: primaryStatus,
            headers: { "retry-after": "45" },
            body: JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }),
          },
    )

    const fallback = await startMockUpstream(() => ({
      status: 200,
      body: JSON.stringify({
        id: "chatcmpl-fb",
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "from openai fallback" } }],
        usage: { prompt_tokens: 9, completion_tokens: 5 },
      }),
    }))

    const logs: GatewayLogEvent[] = []
    const gw = await startGw(
      {
        enabled: true,
        host: "127.0.0.1",
        port: 0,
        injectMode: "headless",
        cooldownMs: 30_000,
        maxCooldownMs: 120_000,
        requestTimeoutMs: 10_000,
        providers: [
          {
            id: "primary-ant",
            protocol: "anthropic",
            baseUrl: primary.url,
            priority: 10,
            models: ["claude-*"],
            enabled: true,
          },
          {
            id: "fallback-oai",
            protocol: "openai",
            baseUrl: `${fallback.url}/v1`,
            priority: 20,
            models: ["claude-*"],
            modelMap: { "claude-sonnet-4-5": "anthropic/claude-sonnet-4.5" },
            enabled: true,
          },
        ],
      },
      { "primary-ant": primaryKey, "fallback-oai": fallbackKey },
      logs,
    )

    const token = gw.sessionEnv().token as string

    // 1. Direct Anthropic passthrough: upstream sees ONLY real Keychain key, never placeholder token.
    const r1 = await fetch(`${gw.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": token },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        messages: [{ role: "user", content: "hi" }],
      }),
    })
    expect(r1.status).toBe(200)
    expect(r1.headers.get("x-rove-gateway-provider")).toBe("primary-ant")
    expect(primary.requests[0]?.headers["x-api-key"]).toBe(primaryKey)
    expect((await r1.json()) as Record<string, unknown>).toMatchObject({
      content: [{ type: "text", text: "from primary" }],
    })

    // 2. Primary hits 429 -> gateway cools it down and fails over to OpenAI provider with translation + modelMap.
    primaryStatus = 429
    const r2 = await fetch(`${gw.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": token },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        messages: [{ role: "user", content: "hi again" }],
      }),
    })
    expect(r2.status).toBe(200)
    expect(r2.headers.get("x-rove-gateway-provider")).toBe("fallback-oai")
    expect(fallback.requests[0]?.headers.authorization).toBe(`Bearer ${fallbackKey}`)
    expect(JSON.parse(fallback.requests[0]?.body ?? "{}").model).toBe("anthropic/claude-sonnet-4.5")
    expect((await r2.json()) as Record<string, unknown>).toMatchObject({
      type: "message",
      model: "claude-sonnet-4-5",
      content: [{ type: "text", text: "from openai fallback" }],
    })

    // 3. Next request skips primary-ant while in cooldown (primary request count stays at 2).
    const r3 = await fetch(`${gw.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": token },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        messages: [{ role: "user", content: "third" }],
      }),
    })
    expect(r3.status).toBe(200)
    expect(primary.requests).toHaveLength(2)
    expect(fallback.requests).toHaveLength(2)
    expect(gw.status().providers.find((p) => p.id === "primary-ant")?.inCooldown).toBe(true)

    // 4. Structured logs record failover and NEVER leak any real key or placeholder token.
    expect(logs.some((l) => l.event === "failover" && l.providerId === "primary-ant" && l.status === 429)).toBe(true)
    const serializedLogs = JSON.stringify(logs)
    expect(serializedLogs).not.toContain(primaryKey)
    expect(serializedLogs).not.toContain(fallbackKey)
    expect(serializedLogs).not.toContain(token)

    // 5. Resetting cooldown brings primary back online.
    primaryStatus = 200
    expect(gw.resetCooldown("primary-ant")).toBe(1)
    const r4 = await fetch(`${gw.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": token },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        messages: [{ role: "user", content: "back" }],
      }),
    })
    expect(r4.headers.get("x-rove-gateway-provider")).toBe("primary-ant")
  })

  it("does not fail over or cool down on client 400 errors, and streams OpenAI SSE translated to Anthropic SSE", async () => {
    const primary = await startMockUpstream(() => ({
      status: 400,
      body: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad param" } }),
    }))
    const streamUpstream = await startMockUpstream(() => ({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: [
        'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"streamed"}}]}\n\n',
        'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
    }))

    const gw = await startGw(
      {
        enabled: true,
        host: "127.0.0.1",
        port: 0,
        injectMode: "headless",
        cooldownMs: 30_000,
        maxCooldownMs: 60_000,
        requestTimeoutMs: 10_000,
        providers: [
          {
            id: "ant-400",
            protocol: "anthropic",
            baseUrl: primary.url,
            priority: 10,
            models: ["bad-model"],
            enabled: true,
          },
          {
            id: "oai-stream",
            protocol: "openai",
            baseUrl: `${streamUpstream.url}/v1`,
            priority: 20,
            models: ["bad-model", "stream-model"],
            enabled: true,
          },
        ],
      },
      { "ant-400": "sk-1", "oai-stream": "sk-2" },
    )
    const token = gw.sessionEnv().token as string

    const badRes = await fetch(`${gw.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": token },
      body: JSON.stringify({ model: "bad-model", max_tokens: 16, messages: [{ role: "user", content: "x" }] }),
    })
    expect(badRes.status).toBe(400)
    expect(streamUpstream.requests).toHaveLength(0)
    expect(gw.status().providers.find((p) => p.id === "ant-400")?.inCooldown).toBe(false)

    const sseRes = await fetch(`${gw.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": token },
      body: JSON.stringify({
        model: "stream-model",
        max_tokens: 16,
        stream: true,
        messages: [{ role: "user", content: "x" }],
      }),
    })
    expect(sseRes.status).toBe(200)
    expect(sseRes.headers.get("content-type")).toContain("text/event-stream")
    const sseText = await sseRes.text()
    expect(sseText).toContain("event: message_start")
    expect(sseText).toContain('"text":"streamed"')
    expect(sseText).toContain("event: message_stop")
  })

  it("wires daemon gateway RPCs (status, sessionEnv, reload, resetCooldown) through controller", async () => {
    let rawConfig: unknown = { enabled: false }
    const controller = new ProviderGatewayController({
      loadConfig: () => rawConfig,
      credentialDeps: credDepsWithKeys({}),
    })
    openServers.push({ close: () => controller.close() })
    await controller.start()

    const { ctx } = fakeCtx({})
    const withGw = { ...ctx, gateway: controller }

    const initial = (await dispatch("gateway.status", {}, withGw)) as { enabled: boolean; running: boolean }
    expect(initial.enabled).toBe(false)
    expect(initial.running).toBe(false)

    rawConfig = { enabled: true, host: "127.0.0.1", port: 0, providers: [] }
    const reloaded = (await dispatch("gateway.reload", {}, withGw)) as {
      enabled: boolean
      running: boolean
      baseUrl: string | null
    }
    expect(reloaded.enabled).toBe(true)
    expect(reloaded.running).toBe(true)
    expect(reloaded.baseUrl?.startsWith("http://127.0.0.1:")).toBe(true)

    const env = (await dispatch("gateway.sessionEnv", {}, withGw)) as {
      running: boolean
      baseUrl: string | null
      token: string | null
    }
    expect(env.running).toBe(true)
    expect(env.baseUrl).toBe(reloaded.baseUrl)
    expect(env.token?.startsWith("rove-gw-")).toBe(true)

    const reset = (await dispatch("gateway.resetCooldown", {}, withGw)) as { reset: number }
    expect(reset).toEqual({ reset: 0 })
  })
})
