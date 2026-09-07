import type { DaemonRequestName } from "../daemon/protocol.ts"

/**
 * Minimal daemon RPC seam.
 *
 * The socket client and the daemon-internal direct adapter both satisfy this
 * interface. Streaming/subscription lifecycle stays on each transport; callers
 * that only need request/response should depend on this.
 */
export interface DaemonRpcClient {
  request<T = unknown>(name: DaemonRequestName, payload?: unknown): Promise<T>
}
