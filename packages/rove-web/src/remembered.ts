/**
 * The last reply each client got per request, so a view that remounts on every open (the composer, a dialog, a page,
 * a settings section) draws from it at once while it rereads, instead of a placeholder that then jumps to the real value.
 */

import type { BridgeClient } from "./bridge.ts"

type Source = BridgeClient | { readonly client: BridgeClient }

const replies = new WeakMap<BridgeClient, Map<string, unknown>>()

const clientOf = (source: Source): BridgeClient => ("client" in source ? source.client : source)
const keyOf = (op: string, params?: Record<string, unknown>): string =>
  params ? `${op} ${JSON.stringify(params)}` : op

export function lastReply<T>(source: Source, op: string, params?: Record<string, unknown>): T | undefined {
  return replies.get(clientOf(source))?.get(keyOf(op, params)) as T | undefined
}

/** Remember a value under `op` + `params`, for a view whose state is built from several replies. */
export function remember<T>(source: Source, op: string, params: Record<string, unknown> | undefined, value: T): T {
  const client = clientOf(source)
  const byKey = replies.get(client) ?? new Map<string, unknown>()
  replies.set(client, byKey.set(keyOf(op, params), value))
  return value
}

/** `client.request`, remembering the reply for `lastReply`. */
export function requestRemembered<T>(source: Source, op: string, params?: Record<string, unknown>): Promise<T> {
  return clientOf(source)
    .request<T>(op, params)
    .then((reply) => remember(source, op, params, reply))
}
