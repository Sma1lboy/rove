/**
 * GitHub sign-in per machine, for Settings → Connectors. Each op wraps one `github-*` verb; with a
 * `machine` the verb runs in that registered machine's daemon, next to its `gh`. A machine that cannot
 * answer is a value (`reason`), never a throw: the page shows it in that machine's row.
 */

import { BridgeError, optBool } from "../protocol.ts"
import { flag } from "./args.ts"
import { attempt, machineOf } from "./machine-outcome.ts"
import type { OpSpec, OpTable } from "./types.ts"

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
