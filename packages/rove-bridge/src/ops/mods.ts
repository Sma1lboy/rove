/**
 * Mods: a press on a button a mod drew. The open panes themselves reach the
 * client as the `mods` push (server.ts), never through an op.
 *
 * Inside the security boundary in `ops/settings.ts`: a press runs code the
 * user already installed, with only the button's key as input — as
 * `plugin.chordAction` does — and authors nothing the Mac runs.
 */

import { MOD_KEY_PATTERN, MOD_PANE_ID_PATTERN } from "@sma1lboy/rove-daemon/plugins/mod-tree"
import { BridgeError } from "../protocol.ts"
import { text } from "./args.ts"
import type { OpTable } from "./types.ts"

const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export const modsOps: OpTable = {
  "mod.press": {
    kind: "write",
    destructive: false,
    wraps: "daemon RPC mod.press (forwards a button key to the mod that drew it)",
    async run(a, { api }) {
      const plugin = text(a, "plugin", 128)
      const pane = text(a, "pane", 64)
      const key = text(a, "key", 64)
      if (!PLUGIN_ID.test(plugin) || !MOD_PANE_ID_PATTERN.test(pane) || !MOD_KEY_PATTERN.test(key)) {
        throw new BridgeError("BAD_ARGS", "plugin, pane or key is not a mod id")
      }
      const res = await api.rpc<{ ok: boolean; reason?: string }>("mod.press", { plugin, pane, key })
      if (!res.ok)
        throw new BridgeError("MOD_UNAVAILABLE", `the press did not reach the mod (${res.reason ?? "unknown"})`)
      return {}
    },
  },
}
