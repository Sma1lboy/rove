/** Verbs that act on a registered machine from this one. */

import { errorMessage } from "../../lib/error-message.ts"
import { requireMachine } from "../../machines/forward.ts"
import { upgradeMachine } from "../../machines/upgrade.ts"
import { ApiError, type VerbSpec } from "./types.ts"

export const MACHINE_UPDATE_VERB: VerbSpec = {
  name: "machine-update",
  group: "edit",
  summary:
    "Update Rove on a registered machine, from here: that machine installs the newest build of THIS machine's release channel and restarts its own daemon. Its sessions keep running; anything its daemon was doing is cut off. Returns { alias, from, to, changed }. Takes --to, not --machine, because the verb itself runs here. Can take minutes.",
  flags: [
    {
      name: "to",
      type: "string",
      required: true,
      placeholder: "ALIAS",
      description: "The registered machine to update.",
    },
  ],
  handler: async (ctx) => {
    if (ctx.caller.forwarded) {
      throw new ApiError(
        "machine-update only runs on the machine that registered the target",
        "MACHINE_UPDATE_FORWARDED",
      )
    }
    const entry = requireMachine(ctx.args.require("to"))
    try {
      return await upgradeMachine(entry)
    } catch (err) {
      throw new ApiError(errorMessage(err), "MACHINE_UPDATE_FAILED", { machine: entry.alias })
    }
  },
}
