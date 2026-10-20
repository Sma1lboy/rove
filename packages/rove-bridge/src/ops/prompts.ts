/**
 * A plugin's input dialog (`rove api prompt`), answered from a client. The question arrives as the
 * `prompt` push (server.ts). Inside the boundary in `ops/settings.ts`: the answer is text handed to
 * code the user installed, as the TUI's own dialog hands it.
 */

import { BridgeError } from "../protocol.ts"
import type { OpTable } from "./types.ts"

const PROMPT_ID = /^[A-Za-z0-9-]{1,64}$/
const ANSWER_MAX = 4000

export const promptOps: OpTable = {
  "ui.promptReply": {
    kind: "write",
    destructive: false,
    wraps: "daemon RPC ui.promptReply (answers or cancels a plugin's input dialog; first answer wins)",
    async run(a, { api }) {
      const promptId = a.promptId
      if (typeof promptId !== "string" || !PROMPT_ID.test(promptId)) {
        throw new BridgeError("BAD_ARGS", "promptId is not a prompt id")
      }
      const value = a.value
      if (value !== undefined && (typeof value !== "string" || value.length > ANSWER_MAX)) {
        throw new BridgeError("BAD_ARGS", `value must be text of at most ${ANSWER_MAX} characters`)
      }
      const res = await api.rpc<{ ok: boolean }>("ui.promptReply", {
        promptId,
        ...(value !== undefined ? { value } : {}),
      })
      // Another client answered first, or the plugin stopped waiting.
      if (!res.ok) throw new BridgeError("PROMPT_GONE", "this question was already answered or timed out")
      return {}
    },
  },
}
