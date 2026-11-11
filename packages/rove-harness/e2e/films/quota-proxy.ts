/**
 * `bun e2e/films/quota-proxy.ts` — an Anthropic-compatible proxy for the handoff film. It forwards
 * every request to `QUOTA_PROXY_UPSTREAM` until the trip file exists. From then on it lets
 * `QUOTA_PROXY_ALLOW` more agent-loop requests through (those that carry tools), so the turn gets
 * some real work on screen, and answers every later `/v1/messages` with 429 the way a spent usage
 * window does: Claude Code stops the turn with a rate-limit failure instead of retrying. The
 * storyboard creates the trip file at the beat it wants.
 */

import { appendFileSync, existsSync } from "node:fs"

const upstream = process.env.QUOTA_PROXY_UPSTREAM ?? "http://127.0.0.1:3425"
const port = Number.parseInt(process.env.QUOTA_PROXY_PORT ?? "8951", 10)
const trip = process.env.QUOTA_PROXY_TRIP ?? "/tmp/rove-quota-trip"
const log = process.env.QUOTA_PROXY_LOG
let allowance = Number.parseInt(process.env.QUOTA_PROXY_ALLOW ?? "0", 10)

Bun.serve({
  port,
  hostname: "127.0.0.1",
  idleTimeout: 255,
  async fetch(request) {
    const url = new URL(request.url)
    const body = request.method === "POST" ? await request.text() : undefined
    let spent = false
    if (existsSync(trip) && url.pathname === "/v1/messages") {
      const agentLoop = /"tools"\s*:\s*\[\s*\{/.test(body ?? "")
      if (allowance > 0 && agentLoop) allowance -= 1
      else if (allowance <= 0) spent = true
    }
    if (log) appendFileSync(log, `${new Date().toISOString()} ${spent ? "429" : "fwd"} ${request.method} ${url.pathname}\n`)
    if (spent) {
      const reset = Math.floor(Date.now() / 1000) + 3 * 3600
      return Response.json(
        { type: "error", error: { type: "rate_limit_error", message: "You've hit your usage limit. It resets in 3 hours." } },
        {
          status: 429,
          headers: {
            "x-should-retry": "false",
            "retry-after": "10800",
            "anthropic-ratelimit-unified-status": "rejected",
            "anthropic-ratelimit-unified-reset": String(reset),
            "anthropic-ratelimit-unified-representative-claim": "five_hour",
          },
        },
      )
    }
    const headers = new Headers(request.headers)
    headers.delete("host")
    return fetch(`${upstream}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body,
    })
  },
})
console.error(`[quota-proxy] :${port} → ${upstream}; trips on ${trip}`)
