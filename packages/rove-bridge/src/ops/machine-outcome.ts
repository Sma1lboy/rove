/**
 * What an op that runs a verb on another registered machine reports when that machine cannot answer:
 * a value (`reason`), never a throw, so the page shows it next to that machine.
 */

import { BridgeError, optStr } from "../protocol.ts"
import type { Args } from "./types.ts"

export type Reason = "offline" | "outdated" | "denied" | "failed"
export type Outcome<T> = { ok: true; result: T } | { ok: false; reason: Reason; message: string }

const REASON_BY_CODE: Readonly<Record<string, Reason>> = {
  MACHINE_UNREACHABLE: "offline",
  MACHINE_VERSION_SKEW: "outdated",
  UNKNOWN_VERB: "outdated",
  INBOUND_DENIED: "denied",
}

export async function attempt<T>(call: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, result: await call }
  } catch (err) {
    if (!(err instanceof BridgeError)) throw err
    const reason = Object.hasOwn(REASON_BY_CODE, err.code) ? (REASON_BY_CODE[err.code] as Reason) : "failed"
    return { ok: false, reason, message: err.message }
  }
}

/** The registered machine an op targets; absent (or `local`) = this machine. */
export function machineOf(args: Args): string | undefined {
  const machine = optStr(args, "machine")
  if (machine !== undefined && machine.length > 64) throw new BridgeError("BAD_ARGS", "machine is too long")
  return machine === "local" ? undefined : machine
}
