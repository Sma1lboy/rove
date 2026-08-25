/**
 * Register the user's `plugins:` chords (~/.rove/settings/keybindings.yaml)
 * — each chord fires a plugin pane or action via a detached `kobe plugin`
 * CLI invocation, so the TUI process never blocks and the CLI keeps sole
 * ownership of plugin resolution (registry lookup, env contract, daemon
 * RPC). Kobe ships no default plugin chords; this registers only what the
 * user wrote. Chord-fired ACTIONS run detached without a terminal — anything
 * interactive belongs in a pane instead.
 */

import { kobeCliInvocation } from "@/cli/invocation"
import { spawnDetached } from "../../lib/spawn-detached"
import { pluginKeybindings } from "../../tui/context/keybindings-user"
import type { PluginKeyBinding } from "../../tui/lib/keymap-plugin-bindings"
import { useBindings } from "../lib/keymap"

function firePluginBinding(binding: PluginKeyBinding): void {
  const verb =
    binding.kind === "pane"
      ? ["plugin", "pane", "open", binding.target]
      : ["plugin", "action", "invoke", binding.target]
  const [cmd, ...rest] = [...kobeCliInvocation(), ...verb]
  spawnDetached(cmd as string, rest, {
    onError: (err) => console.warn(`[rove/plugins] ${binding.target}: ${String(err)}`),
  })
}

export function usePluginKeybindings(enabled: boolean): void {
  useBindings(() => ({
    enabled,
    bindings: pluginKeybindings().map((binding) => ({
      key: binding.chord,
      cmd: () => firePluginBinding(binding),
    })),
  }))
}
