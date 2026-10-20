/**
 * `api.invoke`: the verb contract over the daemon socket. The verb runs in
 * this process, so its side effects (PTY host, git, state) happen on the
 * machine whose daemon answered — the property a forwarded socket needs.
 */

import { ROVE_API_VERSION } from "@sma1lboy/rove-plugin-sdk/contract"
import type { ApiEnvelope, ApiParams } from "@sma1lboy/rove-plugin-sdk/contract"
import { optionalBoolean, optionalString, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

function refusal(code: string, message: string): ApiEnvelope {
  return { apiVersion: ROVE_API_VERSION, ok: false, error: { code, message } }
}

/** Flag values are scalars or string lists; anything else cannot be a flag. */
function isParamValue(value: unknown): boolean {
  if (typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  return Array.isArray(value) && value.every((v) => typeof v === "string")
}

export const API_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "api.invoke",
    blocking: true,
    async handle(payload, ctx) {
      const verb = requireString(payload, "verb")
      const raw = payload.params ?? {}
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return refusal("BAD_FLAG", "params must be an object keyed by flag name")
      }
      const params = raw as Record<string, unknown>
      const bad = Object.entries(params).find(([, value]) => !isParamValue(value))
      if (bad) return refusal("BAD_FLAG", `param ${bad[0]} must be a string, number, boolean or string list`)
      if (!ctx.runtime.invokeApi) return refusal("RPC_ERROR", "this daemon cannot run verbs")
      return ctx.runtime.invokeApi(verb, params as ApiParams, ctx.daemon.socketPath, {
        machine: optionalString(payload, "machine"),
        forwarded: optionalBoolean(payload, "forwarded"),
        viaCenter: optionalBoolean(payload, "viaCenter"),
        repoRemote: optionalString(payload, "repoRemote"),
      })
    },
  },
]
