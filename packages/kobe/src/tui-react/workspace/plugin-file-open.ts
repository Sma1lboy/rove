/**
 * Files-pane → plugin file handlers: when an enabled plugin's
 * `[[file_handlers]]` pattern claims a file (a video for examples.video,
 * say), Enter routes to that plugin's action instead of the editor tab.
 * The action runs detached via the CLI — same fire path as plugin chords —
 * with the absolute file path as its argument.
 */

import { basename } from "node:path"
import { kobeCliInvocation } from "@/cli/invocation"
import { findFileHandler } from "@sma1lboy/kobe-daemon/plugins/settings-env"
import { spawnDetached } from "../../lib/spawn-detached"

/** True when a plugin claimed the file (and its action was fired). */
export function tryPluginFileOpen(absPath: string): boolean {
  let handler: { qualifiedAction: string } | null = null
  try {
    handler = findFileHandler(basename(absPath))
  } catch {
    return false
  }
  if (!handler) return false
  const [cmd, ...rest] = [...kobeCliInvocation(), "plugin", "action", "invoke", handler.qualifiedAction, absPath]
  return spawnDetached(cmd as string, rest, {
    onError: (err) => console.warn(`[rove/plugins] ${handler?.qualifiedAction}: ${String(err)}`),
  })
}
