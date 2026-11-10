/**
 * Webhook trigger for a routine: GitHub (or anything that signs the same way)
 * POSTs to the web server's `/hooks/routines/<id>`, the daemon checks the
 * `X-Hub-Signature-256` HMAC against the routine's own secret and fires one
 * run. The secret never leaves the daemon except in the routine record.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

/** What fired a webhook run, as the precheck and the prompt see it. */
export interface WebhookEvent {
  /** `X-GitHub-Event`, e.g. `issues`; `unknown` when the sender names none. */
  readonly name: string
  /** The payload's `action` (`opened`, `reopened`…), when it has one. */
  readonly action?: string
  /** One line for the prompt: event, repo, number and link when the payload has them. */
  readonly summary: string
}

export function newWebhookSecret(): string {
  return randomBytes(24).toString("hex")
}

/** True when `header` is `sha256=<hex>` of `body` under `secret`. Constant-time. */
export function webhookSignatureValid(secret: string, body: string, header: string | null | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false
  const expected = createHmac("sha256", secret).update(body, "utf8").digest()
  const presented = Buffer.from(header.slice("sha256=".length), "hex")
  return presented.length === expected.length && timingSafeEqual(presented, expected)
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/** Reads the event out of a JSON body; a body that isn't JSON still fires, with just the event name. */
export function readWebhookEvent(name: string | null | undefined, body: string): WebhookEvent {
  const event = text(name) ?? "unknown"
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    payload = undefined
  }
  const action = text(field(payload, "action"))
  const repo = text(field(field(payload, "repository"), "full_name"))
  const item = field(payload, "issue") ?? field(payload, "pull_request")
  const number = field(item, "number")
  const url = text(field(item, "html_url"))
  const parts = [
    action ? `${event}.${action}` : event,
    repo && typeof number === "number" ? `${repo}#${number}` : repo,
    url,
  ].filter(Boolean)
  return { name: event, ...(action ? { action } : {}), summary: parts.join(" ") }
}

/** Env the precheck runs with, so it can filter: `[ "$ROVE_WEBHOOK_ACTION" = opened ]`. */
export function webhookPrecheckEnv(event: WebhookEvent): Record<string, string> {
  return {
    ROVE_WEBHOOK_EVENT: event.name,
    ROVE_WEBHOOK_ACTION: event.action ?? "",
  }
}
