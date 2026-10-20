/**
 * Mods: a press on a button or a submitted field a mod drew. The open panes
 * themselves reach the client as the `mods` push (server.ts), never through an op.
 *
 * Inside the security boundary in `ops/settings.ts`: both run code the user
 * already installed, with only a control key (and the field's text) as input —
 * as `plugin.chordAction` and `term.input` do — and author nothing the Mac runs.
 */

import { MOD_INPUT_MAX, MOD_KEY_PATTERN, MOD_PANE_ID_PATTERN } from "@sma1lboy/rove-daemon/plugins/mod-tree"
import { BridgeError } from "../protocol.ts"
import { text } from "./args.ts"
import type { Args, OpTable } from "./types.ts"

const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function control(a: Args): { plugin: string; pane: string; key: string } {
  const plugin = text(a, "plugin", 128)
  const pane = text(a, "pane", 64)
  const key = text(a, "key", 64)
  if (!PLUGIN_ID.test(plugin) || !MOD_PANE_ID_PATTERN.test(pane) || !MOD_KEY_PATTERN.test(key)) {
    throw new BridgeError("BAD_ARGS", "plugin, pane or key is not a mod id")
  }
  return { plugin, pane, key }
}

function delivered(res: { ok: boolean; reason?: string }): Record<string, never> {
  if (!res.ok) throw new BridgeError("MOD_UNAVAILABLE", `the mod did not get it (${res.reason ?? "unknown"})`)
  return {}
}

export const modsOps: OpTable = {
  "mod.press": {
    kind: "write",
    destructive: false,
    wraps: "daemon RPC mod.press (forwards a button key to the mod that drew it)",
    async run(a, { api }) {
      return delivered(await api.rpc<{ ok: boolean; reason?: string }>("mod.press", control(a)))
    },
  },

  "mod.submit": {
    kind: "write",
    destructive: false,
    wraps: "daemon RPC mod.submit (forwards an input field's text to the mod that drew it)",
    async run(a, { api }) {
      const value = a.value
      // An empty submit is a valid answer; only the type and the cap are checked.
      if (typeof value !== "string") throw new BridgeError("BAD_ARGS", "value must be text")
      if (value.length > MOD_INPUT_MAX)
        throw new BridgeError("BAD_ARGS", `value is longer than ${MOD_INPUT_MAX} characters`)
      return delivered(await api.rpc<{ ok: boolean; reason?: string }>("mod.submit", { ...control(a), value }))
    },
  },
}
