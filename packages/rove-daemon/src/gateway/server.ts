/**
 * Local loopback HTTP provider gateway server for `rove-daemon`.
 *
 * Security invariants:
 * - Binds ONLY to a validated literal loopback IP (`127.0.0.1` or `::1`).
 * - Requires a per-daemon-lifetime random token on EVERY HTTP route.
 * - Token lives strictly in memory (never written to disk); real upstream API
 *   keys are resolved just-in-time from Keychain / env and never logged.
 */

import { randomBytes } from "node:crypto"
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { validateBindHost } from "./config.ts"
import {
  buildUpstreamHeaders,
  buildUpstreamUrl,
  constantTimeTokenEquals,
  extractClientToken,
  isSseResponse,
  mintGatewayToken,
  pipeReadableToResponse,
  readRequestBody,
  writeJson,
  writeProtocolError,
} from "./http-helpers.ts"
import { type GatewayCredentialDeps, isGatewayKeychainSupported, resolveProviderApiKey } from "./keychain.ts"
import { ProviderGatewayRouter, isFailoverStatus, resolveUpstreamModel, scrubSecretText } from "./router.ts"
import {
  anthropicSseToOpenAiSse,
  anthropicToOpenAiRequest,
  anthropicToOpenAiResponse,
  extractRequestedModel,
  openAiSseToAnthropicSse,
  openAiToAnthropicRequest,
  openAiToAnthropicResponse,
  rewriteBodyModel,
} from "./translate.ts"
import type {
  GatewayLogEvent,
  GatewayProviderProtocol,
  ProviderGatewayConfig,
  ProviderGatewaySessionEnv,
  ProviderGatewayStatus,
} from "./types.ts"

export type GatewayFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface ProviderGatewayServerOptions {
  readonly config: ProviderGatewayConfig
  readonly credentialDeps?: GatewayCredentialDeps
  readonly fetchImpl?: GatewayFetch
  readonly onLog?: (event: GatewayLogEvent) => void
  readonly now?: () => number
  /** Injectable for deterministic tests; defaults to a fresh 192-bit random token. */
  readonly token?: string
}

export interface ProviderGatewayHandle {
  readonly baseUrl: string
  readonly host: "127.0.0.1" | "::1"
  readonly port: number
  status(): ProviderGatewayStatus
  sessionEnv(): ProviderGatewaySessionEnv
  updateConfig(config: ProviderGatewayConfig): void
  resetCooldown(providerId?: string): number
  close(): Promise<void>
}

export async function startProviderGateway(options: ProviderGatewayServerOptions): Promise<ProviderGatewayHandle> {
  const host = validateBindHost(options.config.host)
  if (!host) {
    throw new Error(
      `provider gateway must bind to loopback ("127.0.0.1" or "::1"), got "${String(options.config.host)}"`,
    )
  }
  const token = options.token ?? mintGatewayToken()
  const fetchImpl: GatewayFetch = options.fetchImpl ?? ((url, init) => fetch(url, init))
  const now = options.now ?? (() => Date.now())
  const router = new ProviderGatewayRouter(options.config, {
    now,
    onLog: options.onLog,
    credentialDeps: options.credentialDeps,
  })

  async function forwardProxyRequest(
    req: IncomingMessage,
    res: ServerResponse,
    inboundProtocol: GatewayProviderProtocol,
    endpointPath: string,
  ): Promise<void> {
    const requestId = randomBytes(6).toString("hex")
    let rawBody: Buffer
    try {
      rawBody = await readRequestBody(req)
    } catch (err) {
      writeProtocolError(res, inboundProtocol, 413, err instanceof Error ? err.message : String(err))
      return
    }

    let parsedBody: Record<string, unknown>
    try {
      const json: unknown = JSON.parse(rawBody.toString("utf8"))
      if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("body must be a JSON object")
      parsedBody = json as Record<string, unknown>
    } catch (err) {
      writeProtocolError(
        res,
        inboundProtocol,
        400,
        `invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
      )
      return
    }

    const requestedModel = extractRequestedModel(parsedBody)
    if (!requestedModel) {
      writeProtocolError(res, inboundProtocol, 400, "model is required")
      return
    }

    const { ready, cooling } = router.selectCandidates(requestedModel)
    if (ready.length === 0 && cooling.length === 0) {
      router.emitLog({
        event: "exhausted",
        requestId,
        inboundProtocol,
        model: requestedModel,
        status: 404,
        reason: "no configured provider matches requested model",
      })
      writeProtocolError(res, inboundProtocol, 404, `no configured gateway provider offers model "${requestedModel}"`)
      return
    }

    if (ready.length === 0) {
      const earliestMs = Math.min(...cooling.map((c) => c.retryAfterMs))
      const retryAfterSec = Math.max(1, Math.ceil(earliestMs / 1000))
      router.emitLog({
        event: "exhausted",
        requestId,
        inboundProtocol,
        model: requestedModel,
        status: 429,
        cooldownMs: earliestMs,
        reason: "all matching providers are in cooldown",
      })
      writeProtocolError(
        res,
        inboundProtocol,
        429,
        `all configured providers for model "${requestedModel}" are in cooldown; retry in ${retryAfterSec}s`,
        { "retry-after": String(retryAfterSec) },
      )
      return
    }

    let lastFailureStatus = 502
    let lastFailureBody: string | null = null
    let lastFailureContentType: string | null = null
    let lastFailureMessage = "all matching providers failed"
    let attempt = 0

    for (const provider of ready) {
      attempt++
      const resolvedKey = resolveProviderApiKey(provider, options.credentialDeps)
      if (!resolvedKey) {
        const cooldownMs = router.recordFailoverFailure(provider.id, {
          status: null,
          reason: "missing API key in keychain/env",
        })
        router.emitLog({
          event: "failover",
          requestId,
          inboundProtocol,
          model: requestedModel,
          providerId: provider.id,
          upstreamProtocol: provider.protocol,
          attempt,
          cooldownMs,
          reason: "missing API key",
        })
        lastFailureMessage = `provider "${provider.id}" has no API key configured`
        continue
      }

      const upstreamModel = resolveUpstreamModel(provider, requestedModel)
      if (endpointPath === "/v1/messages/count_tokens" && provider.protocol !== "anthropic") continue

      const translated = inboundProtocol !== provider.protocol
      let outboundBody: Record<string, unknown>
      let upstreamPath: string
      if (!translated) {
        outboundBody = rewriteBodyModel(parsedBody, upstreamModel)
        upstreamPath = endpointPath
      } else if (inboundProtocol === "anthropic" && provider.protocol === "openai") {
        outboundBody = anthropicToOpenAiRequest(parsedBody, upstreamModel)
        upstreamPath = "/v1/chat/completions"
      } else {
        outboundBody = openAiToAnthropicRequest(parsedBody, upstreamModel)
        upstreamPath = "/v1/messages"
      }

      const upstreamUrl = buildUpstreamUrl(provider, upstreamPath)
      const upstreamHeaders = buildUpstreamHeaders(provider, resolvedKey.key, req.headers)
      const startedAt = now()

      let upstreamRes: Response
      try {
        upstreamRes = await fetchImpl(upstreamUrl, {
          method: "POST",
          headers: upstreamHeaders,
          body: JSON.stringify(outboundBody),
          signal: AbortSignal.timeout(router.getConfig().requestTimeoutMs),
        })
      } catch (err) {
        const latencyMs = now() - startedAt
        const reason = err instanceof Error ? err.message : String(err)
        const cooldownMs = router.recordFailoverFailure(provider.id, { status: null, reason })
        router.emitLog({
          event: "failover",
          requestId,
          inboundProtocol,
          model: requestedModel,
          providerId: provider.id,
          upstreamProtocol: provider.protocol,
          upstreamModel,
          latencyMs,
          attempt,
          cooldownMs,
          reason,
        })
        lastFailureStatus = 502
        lastFailureBody = null
        lastFailureMessage = `provider "${provider.id}" request error: ${scrubSecretText(reason)}`
        continue
      }

      const latencyMs = now() - startedAt
      if (isFailoverStatus(upstreamRes.status)) {
        const retryAfter = upstreamRes.headers.get("retry-after")
        const errText = await upstreamRes.text().catch(() => "")
        const cooldownMs = router.recordFailoverFailure(provider.id, {
          status: upstreamRes.status,
          reason: `upstream HTTP ${upstreamRes.status}`,
          retryAfterHeader: retryAfter,
        })
        router.emitLog({
          event: "failover",
          requestId,
          inboundProtocol,
          model: requestedModel,
          providerId: provider.id,
          upstreamProtocol: provider.protocol,
          upstreamModel,
          status: upstreamRes.status,
          latencyMs,
          attempt,
          cooldownMs,
          reason: `HTTP ${upstreamRes.status}`,
        })
        lastFailureStatus = upstreamRes.status
        lastFailureBody = !translated ? errText : null
        lastFailureContentType = !translated ? upstreamRes.headers.get("content-type") : null
        lastFailureMessage = `provider "${provider.id}" returned HTTP ${upstreamRes.status}`
        continue
      }

      if (!upstreamRes.ok) {
        router.recordPassthroughError(provider.id, upstreamRes.status)
        router.emitLog({
          event: "request",
          requestId,
          inboundProtocol,
          model: requestedModel,
          providerId: provider.id,
          upstreamProtocol: provider.protocol,
          upstreamModel,
          status: upstreamRes.status,
          latencyMs,
          attempt,
        })
        const errText = await upstreamRes.text().catch(() => "")
        if (!translated) {
          res.writeHead(upstreamRes.status, {
            "content-type": upstreamRes.headers.get("content-type") ?? "application/json; charset=utf-8",
          })
          res.end(errText)
        } else {
          writeProtocolError(res, inboundProtocol, upstreamRes.status, errText || `upstream HTTP ${upstreamRes.status}`)
        }
        return
      }

      router.recordSuccess(provider.id, upstreamRes.status)
      router.emitLog({
        event: "request",
        requestId,
        inboundProtocol,
        model: requestedModel,
        providerId: provider.id,
        upstreamProtocol: provider.protocol,
        upstreamModel,
        status: upstreamRes.status,
        latencyMs,
        attempt,
      })

      if (!translated) {
        const outHeaders: Record<string, string> = {
          "content-type": upstreamRes.headers.get("content-type") ?? "application/json; charset=utf-8",
          "x-rove-gateway-provider": provider.id,
        }
        if (isSseResponse(upstreamRes)) outHeaders["cache-control"] = "no-cache"
        res.writeHead(upstreamRes.status, outHeaders)
        if (upstreamRes.body) await pipeReadableToResponse(upstreamRes.body, res)
        else res.end(await upstreamRes.text())
        return
      }

      if (isSseResponse(upstreamRes) && upstreamRes.body) {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          "x-rove-gateway-provider": provider.id,
        })
        const converted =
          inboundProtocol === "anthropic"
            ? openAiSseToAnthropicSse(upstreamRes.body, requestedModel)
            : anthropicSseToOpenAiSse(upstreamRes.body, requestedModel)
        await pipeReadableToResponse(converted, res)
        return
      }

      const rawJson = await upstreamRes.json().catch(() => null)
      if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) {
        writeProtocolError(res, inboundProtocol, 502, "upstream returned non-JSON response")
        return
      }
      const converted =
        inboundProtocol === "anthropic"
          ? openAiToAnthropicResponse(rawJson as Record<string, unknown>, requestedModel)
          : anthropicToOpenAiResponse(rawJson as Record<string, unknown>, requestedModel)
      writeJson(res, 200, converted, { "x-rove-gateway-provider": provider.id })
      return
    }

    router.emitLog({
      event: "exhausted",
      requestId,
      inboundProtocol,
      model: requestedModel,
      status: lastFailureStatus,
      attempt,
      reason: lastFailureMessage,
    })
    if (lastFailureBody !== null && lastFailureContentType) {
      res.writeHead(lastFailureStatus, { "content-type": lastFailureContentType })
      res.end(lastFailureBody)
    } else {
      writeProtocolError(res, inboundProtocol, lastFailureStatus, lastFailureMessage)
    }
  }

  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname
    const inboundProtocol: GatewayProviderProtocol = pathname.startsWith("/v1/messages") ? "anthropic" : "openai"

    const presented = extractClientToken(req)
    if (!presented || !constantTimeTokenEquals(presented, token)) {
      router.emitLog({ event: "auth_failed", reason: `unauthorized ${req.method ?? "GET"} ${pathname}` })
      writeProtocolError(res, inboundProtocol, 401, "invalid or missing gateway token")
      return
    }

    if (req.method === "GET" && pathname === "/health") {
      writeJson(res, 200, { ok: true, status: handle.status() })
      return
    }

    if (req.method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
      const models = new Set<string>()
      for (const p of router.getConfig().providers) {
        if (!p.enabled) continue
        for (const m of p.models) if (!m.includes("*")) models.add(m)
      }
      writeJson(res, 200, {
        object: "list",
        data: [...models].map((id) => ({ id, object: "model", owned_by: "rove-gateway" })),
      })
      return
    }

    if (req.method === "POST" && (pathname === "/v1/messages" || pathname === "/v1/messages/count_tokens")) {
      void forwardProxyRequest(req, res, "anthropic", pathname).catch((err) => {
        if (!res.headersSent) {
          writeProtocolError(res, "anthropic", 500, err instanceof Error ? err.message : String(err))
        } else if (!res.writableEnded) {
          res.end()
        }
      })
      return
    }

    if (req.method === "POST" && (pathname === "/v1/chat/completions" || pathname === "/chat/completions")) {
      void forwardProxyRequest(req, res, "openai", "/v1/chat/completions").catch((err) => {
        if (!res.headersSent) {
          writeProtocolError(res, "openai", 500, err instanceof Error ? err.message : String(err))
        } else if (!res.writableEnded) {
          res.end()
        }
      })
      return
    }

    writeProtocolError(res, inboundProtocol, 404, `unsupported route: ${req.method ?? "GET"} ${pathname}`)
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.config.port, host, () => {
      server.off("error", reject)
      resolve()
    })
  })

  const addr = server.address() as AddressInfo
  const boundPort = addr.port
  const baseUrl = host === "::1" ? `http://[::1]:${boundPort}` : `http://${host}:${boundPort}`
  let closed = false

  router.emitLog({ event: "started", reason: `listening on ${baseUrl}` })

  const handle: ProviderGatewayHandle = {
    baseUrl,
    host,
    port: boundPort,
    status() {
      const cfg = router.getConfig()
      return {
        enabled: cfg.enabled,
        running: !closed,
        host,
        port: closed ? null : boundPort,
        baseUrl: closed ? null : baseUrl,
        injectMode: cfg.injectMode,
        keychainSupported: isGatewayKeychainSupported(options.credentialDeps),
        providers: router.providerStatuses(),
      }
    },
    sessionEnv() {
      const cfg = router.getConfig()
      return {
        enabled: cfg.enabled,
        running: !closed,
        baseUrl: closed ? null : baseUrl,
        token: closed ? null : token,
        injectMode: cfg.injectMode,
      }
    },
    updateConfig(next) {
      router.updateConfig(next)
    },
    resetCooldown(providerId) {
      return router.resetCooldown(providerId)
    },
    async close() {
      if (closed) return
      closed = true
      await new Promise<void>((resolve) => server.close(() => resolve()))
      router.emitLog({ event: "stopped", reason: `closed ${baseUrl}` })
    },
  }

  return handle
}
