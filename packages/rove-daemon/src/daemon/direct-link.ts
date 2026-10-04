/**
 * In-process RPC link: the socket's handler registry without the round-trip,
 * used by the automation runner to launch engine sessions. Built
 * unconditionally at daemon start: routines run whether or not anyone watches.
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
