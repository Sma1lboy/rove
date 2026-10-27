/**
 * GitHub sign-in per machine, for Settings → Connectors. Each op wraps one `github-*` verb; with a
 * `machine` the verb runs in that registered machine's daemon, next to its `gh`. A machine that cannot
 * answer is a value (`reason`), never a throw: the page shows it in that machine's row.
 */

import { BridgeError, optBool, optStr } from "../protocol.ts"
import { flag } from "./args.ts"
import type { Args, OpSpec, OpTable } from "./types.ts"

type Reason = "offline" | "outdated" | "denied" | "failed"
type Outcome<T> = { ok: true; result: T } | { ok: false; reason: Reason; message: string }

const REASON_BY_CODE: Readonly<Record<string, Reason>> = {
  MACHINE_UNREACHABLE: "offline",
  MACHINE_VERSION_SKEW: "outdated",
  UNKNOWN_VERB: "outdated",
  INBOUND_DENIED: "denied",
}

async function attempt<T>(call: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, result: await call }
  } catch (err) {
    if (!(err instanceof BridgeError)) throw err
    const reason = Object.hasOwn(REASON_BY_CODE, err.code) ? (REASON_BY_CODE[err.code] as Reason) : "failed"
    return { ok: false, reason, message: err.message }
  }
}

/** The registered machine an op targets; absent (or `local`) = this machine. */
function machineOf(args: Args): string | undefined {
  const machine = optStr(args, "machine")
  if (machine !== undefined && machine.length > 64) throw new BridgeError("BAD_ARGS", "machine is too long")
  return machine === "local" ? undefined : machine
}

const spec = (kind: OpSpec["kind"], wraps: string, run: OpSpec["run"], destructive = false): OpSpec => ({
  kind,
  destructive,
  wraps,
  run,
})

export const githubAuthOps: OpTable = {
  "github.status": spec("read", "github-status (on `machine`, else this machine)", async (args, ctx) => {
    const out = await attempt(ctx.api.verb<unknown>("github-status", [], machineOf(args)))
    return out.ok ? { status: out.result } : { status: null, reason: out.reason, message: out.message }
  }),
  "github.login": spec("write", "github-login [--cancel] (on `machine`, else this machine)", (args, ctx) =>
    attempt(
      ctx.api.verb<unknown>("github-login", optBool(args, "cancel") ? [flag("cancel", "true")] : [], machineOf(args)),
    ),
  ),
  "github.logout": spec(
    "write",
    "github-logout (this machine's gh, signed out)",
    (_args, ctx) => attempt(ctx.api.verb<unknown>("github-logout", [])),
    true,
  ),
  "github.sync": spec(
    "write",
    "github-sync --to `machine` (this machine's account signed in there)",
    async (args, ctx) => {
      const machine = machineOf(args)
      if (!machine) throw new BridgeError("BAD_ARGS", "machine must name a registered machine")
      return attempt(ctx.api.verb<unknown>("github-sync", [flag("to", machine)]))
    },
  ),
}
