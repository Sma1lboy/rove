import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { DaemonRequestName } from "@sma1lboy/rove-daemon/daemon/protocol"
import { invokeVerb } from "@sma1lboy/rove/src/cli/api-cmd.ts"
import { BridgeError } from "../protocol.ts"
import type { BridgeApi } from "./types.ts"

/** Rethrow with the refusal's stable `code` kept on the wire. */
function asBridgeError(err: unknown, fallback: string): BridgeError {
  const code = err && typeof err === "object" && "code" in err ? err.code : undefined
  return new BridgeError(typeof code === "string" ? code : fallback, err instanceof Error ? err.message : String(err))
}

/** `rove api` verbs in-process and daemon RPCs, both through one daemon client. */
export function createBridgeApi(client: RoveDaemonClient): BridgeApi {
  return {
    async verb<T>(name: string, argv: readonly string[]): Promise<T> {
      try {
        // In-process result of a `rove api` verb whose shape docs/API.md pins.
        return (await invokeVerb(name, argv, { client })) as T
      } catch (err) {
        throw asBridgeError(err, "RPC_ERROR")
      }
    },
    async rpc<T>(name: DaemonRequestName, payload?: unknown): Promise<T> {
      try {
        return await client.request<T>(name, payload)
      } catch (err) {
        throw asBridgeError(err, "RPC_ERROR")
      }
    },
  }
}
