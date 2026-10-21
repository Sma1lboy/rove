import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { DaemonRequestName } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { ApiEnvelope, ApiParams } from "@sma1lboy/rove-daemon/daemon/protocol"
import { ApiError, invokeVerb } from "@sma1lboy/rove/src/cli/api-cmd.ts"
import { argvToParams } from "@sma1lboy/rove/src/cli/api/invoke.ts"
import { BridgeError } from "../protocol.ts"
import type { BridgeApi } from "./types.ts"

/** Rethrow with the refusal's stable `code` and its recovery data kept on the wire. */
function asBridgeError(err: unknown, fallback: string): BridgeError {
  const code = err && typeof err === "object" && "code" in err ? err.code : undefined
  const data = err instanceof ApiError ? err.data : undefined
  return new BridgeError(
    typeof code === "string" ? code : fallback,
    err instanceof Error ? err.message : String(err),
    data,
  )
}

/** Tasks of the other registered machines, and how to run a verb inside one of them (`forwardVerb`). */
export interface RemoteVerbs {
  machineOf(taskId: string): string | undefined
  forward(alias: string, verb: string, params: ApiParams): Promise<ApiEnvelope>
}

/** The `--task-id` an argv names, in either `--task-id X` or `--task-id=X` form. */
function taskIdOf(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--task-id") return argv[i + 1]
    if (arg?.startsWith("--task-id=")) return arg.slice("--task-id=".length)
  }
  return undefined
}

/**
 * `rove api` verbs and daemon RPCs through one daemon client. A verb whose
 * `--task-id` lives on another machine runs inside THAT machine's daemon, so
 * every op built on verbs (tabs, review, send) serves a remote task unchanged.
 */
export function createBridgeApi(client: RoveDaemonClient, remote?: RemoteVerbs): BridgeApi {
  return {
    machineOf: (taskId) => remote?.machineOf(taskId),
    async verb<T>(name: string, argv: readonly string[]): Promise<T> {
      const taskId = taskIdOf(argv)
      const alias = taskId === undefined ? undefined : remote?.machineOf(taskId)
      if (alias !== undefined && remote) {
        let envelope: ApiEnvelope
        try {
          envelope = await remote.forward(alias, name, argvToParams(name, argv))
        } catch (err) {
          throw asBridgeError(err, "RPC_ERROR")
        }
        if (envelope.ok) return envelope.result as T
        const { code, message, ...data } = envelope.error
        throw new BridgeError(code, message, data)
      }
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
