/**
 * `POST /hooks/routines/<id>`: a routine's webhook trigger (`routine-update --webhook`). The body
 * and GitHub's signature header go to the daemon unread; it holds the secret, checks the HMAC and
 * fires the run. No bearer token: the signature is the credential, so GitHub can call it.
 */

import type { BridgeApi } from "./ops/types.ts"

const PATH = /^\/hooks\/routines\/([A-Za-z0-9-]+)$/

/** GitHub caps a delivery at 25 MB; an issue or PR event is a few KB. */
const MAX_BODY_BYTES = 1024 * 1024

const STATUS: Readonly<Record<string, number>> = {
  fired: 202,
  pong: 200,
  not_found: 404,
  bad_signature: 401,
  disabled: 409,
}

/** The answer for a hook request, or null when `req` is not one. */
export async function routineHook(api: BridgeApi, req: Request, log: (line: string) => void): Promise<Response | null> {
  const match = PATH.exec(new URL(req.url).pathname)
  if (!match) return null
  if (req.method !== "POST") return new Response("POST only\n", { status: 405, headers: { allow: "POST" } })
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
    return new Response("too large\n", { status: 413 })
  const body = await req.text()
  if (body.length > MAX_BODY_BYTES) return new Response("too large\n", { status: 413 })
  const id = match[1] as string
  let res: { verdict: string; event?: string }
  try {
    res = await api.rpc("automation.webhook", {
      id,
      body,
      event: req.headers.get("x-github-event"),
      signature: req.headers.get("x-hub-signature-256"),
    })
  } catch (err) {
    log(`[rove-bridge] routine hook ${id}: ${err instanceof Error ? err.message : String(err)}`)
    return new Response("daemon unavailable\n", { status: 503 })
  }
  const status = STATUS[res.verdict] ?? 500
  if (status >= 400) log(`[rove-bridge] routine hook ${id}: ${res.verdict}`)
  return new Response(`${res.verdict}${res.event ? ` ${res.event}` : ""}\n`, { status })
}
