/**
 * The daemon's in-process RPC link.
 *
 * This is the object the automation runner uses to launch engine sessions:
 * the same handler registry the socket serves, dispatched without a socket
 * round-trip. It is built unconditionally at daemon start because a routine
 * has to be able to run whether or not anyone is watching.
 *
 * It used to live in `web-server.ts` alongside the browser dashboard's
 * HTTP/SSE listener. The link never belonged to the listener — that merely
 * reused it — so the link survived #855 while the dashboard did not. Its
 * `snapshot()` half genuinely did belong to the listener, and went in the
 * follow-up: both remaining callers (`handlers-automations.ts`,
 * `handlers-work-items.ts`) take it as a plain `DaemonRpcClient`.
 */

import type { DaemonRpcClient } from "../client/rpc.ts"
import { type DaemonHandlerContext, createDaemonHandlerRegistry, dispatchDaemonRequest } from "./handlers.ts"
import type { DaemonRequestName } from "./protocol.ts"

export function createDirectLink(args: {
  ctx: (clientId: number) => DaemonHandlerContext
}): DaemonRpcClient {
  const handlers = createDaemonHandlerRegistry()
  return {
    async request<T>(name: DaemonRequestName, payload?: unknown): Promise<T> {
      return (await dispatchDaemonRequest(handlers, name, payload, args.ctx(0))) as T
    },
  }
}
