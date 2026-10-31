/**
 * The last reply each client got per request, so a view that remounts on every open (the composer, a dialog) draws
 * from it at once while it rereads, instead of a placeholder that then jumps to the real value.
 */

import type { AppModel } from "./model.ts"

const replies = new WeakMap<object, Map<string, unknown>>()

const keyOf = (op: string, params?: Record<string, unknown>): string =>
  params ? `${op} ${JSON.stringify(params)}` : op

export function lastReply<T>(model: AppModel, op: string, params?: Record<string, unknown>): T | undefined {
  return replies.get(model.client)?.get(keyOf(op, params)) as T | undefined
}

/** `model.client.request`, remembering the reply for `lastReply`. */
export function requestRemembered<T>(model: AppModel, op: string, params?: Record<string, unknown>): Promise<T> {
  return model.client.request<T>(op, params).then((reply) => {
    const byKey = replies.get(model.client) ?? new Map<string, unknown>()
    replies.set(model.client, byKey.set(keyOf(op, params), reply))
    return reply
  })
}
