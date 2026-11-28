/**
 * Low-level HTTP helpers for the local loopback provider gateway:
 * token minting + constant-time verification, bounded body reading, upstream
 * URL/header construction, protocol error shaping, and SSE stream piping.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import { scrubSecretText } from "./router.ts"
import type { GatewayProviderConfig, GatewayProviderProtocol } from "./types.ts"

const MAX_BODY_BYTES = 32 * 1024 * 1024
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01"

export function mintGatewayToken(): string {
  return `rove-gw-${randomBytes(24).toString("base64url")}`
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest()
}

export function constantTimeTokenEquals(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b))
}

export function extractClientToken(req: IncomingMessage): string | null {
  const xApiKey = req.headers["x-api-key"]
  if (typeof xApiKey === "string" && xApiKey.trim()) return xApiKey.trim()
  const auth = req.headers.authorization
  if (typeof auth === "string") {
    const match = /^Bearer\s+(\S+)$/i.exec(auth.trim())
    if (match?.[1]) return match[1]
  }
  return null
}

export function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk
      total += buf.length
      if (total > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`))
        return
      }
      chunks.push(buf)
    })
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

export function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload, "utf8"),
    ...(extraHeaders ?? {}),
  })
  res.end(payload)
}

export function writeProtocolError(
  res: ServerResponse,
  protocol: GatewayProviderProtocol,
  status: number,
  message: string,
  extraHeaders?: Record<string, string>,
): void {
  const safeMsg = scrubSecretText(message)
  if (protocol === "anthropic") {
    const type = status === 401 ? "authentication_error" : status === 429 ? "rate_limit_error" : "api_error"
    writeJson(res, status, { type: "error", error: { type, message: safeMsg } }, extraHeaders)
    return
  }
  const type = status === 401 ? "authentication_error" : status === 429 ? "rate_limit_error" : "server_error"
  writeJson(res, status, { error: { message: safeMsg, type, code: String(status) } }, extraHeaders)
}

export function buildUpstreamUrl(provider: GatewayProviderConfig, path: string): string {
  const base = provider.baseUrl.replace(/\/+$/, "")
  if (provider.protocol === "anthropic") {
    if (base.endsWith("/v1") && path.startsWith("/v1/")) return `${base}${path.slice(3)}`
    return `${base}${path}`
  }
  const stripped = path.startsWith("/v1/") ? path.slice(3) : path
  return base.endsWith("/v1") ? `${base}${stripped}` : `${base}/v1${stripped}`
}

export function buildUpstreamHeaders(
  provider: GatewayProviderConfig,
  realKey: string,
  inboundHeaders: IncomingMessage["headers"],
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(provider.extraHeaders ?? {}),
  }
  if (provider.protocol === "anthropic") {
    const version =
      typeof inboundHeaders["anthropic-version"] === "string"
        ? inboundHeaders["anthropic-version"]
        : (headers["anthropic-version"] ?? DEFAULT_ANTHROPIC_VERSION)
    headers["anthropic-version"] = version
    if (typeof inboundHeaders["anthropic-beta"] === "string") {
      headers["anthropic-beta"] = inboundHeaders["anthropic-beta"]
    }
    headers["x-api-key"] = realKey
  } else {
    headers.authorization = `Bearer ${realKey}`
  }
  return headers
}

export async function pipeReadableToResponse(stream: ReadableStream<Uint8Array>, res: ServerResponse): Promise<void> {
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!res.write(value)) {
        await new Promise<void>((resolve) => res.once("drain", resolve))
      }
    }
  } finally {
    reader.releaseLock()
    if (!res.writableEnded) res.end()
  }
}

export function isSseResponse(upstream: Response): boolean {
  const ct = upstream.headers.get("content-type") ?? ""
  return ct.toLowerCase().includes("text/event-stream")
}
