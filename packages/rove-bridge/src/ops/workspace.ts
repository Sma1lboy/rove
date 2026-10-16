/**
 * Workspace ops: split panes inside one terminal tab (the TUI's ctrl+\ / ctrl+= /
 * ctrl+w / F2 / F5 on a split). One op, one `rove api tab-split` call; the shell a
 * new pane runs is always the login shell, so nothing here carries a command line.
 */

import { BridgeError, optInt } from "../protocol.ts"
import { flag, oneOf, optOneOf, tabId, taskId } from "./args.ts"
import type { OpTable } from "./types.ts"

const LEAF = /^leaf-\d{1,4}$/
const TITLE_MAX = 80

function leafId(a: Readonly<Record<string, unknown>>): string | undefined {
  const v = a.leafId
  if (v === undefined || v === null || v === "") return undefined
  if (typeof v !== "string" || !LEAF.test(v)) throw new BridgeError("BAD_ARGS", "leafId is not a pane id")
  return v
}

/** One line, may be empty (an empty name clears back to the default). */
function paneTitle(a: Readonly<Record<string, unknown>>): string {
  const v = a.title
  if (v === undefined || v === null) return ""
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
  if (typeof v !== "string" || v.length > TITLE_MAX || /[\u0000-\u001f\u007f]/.test(v)) {
    throw new BridgeError("BAD_ARGS", `title must be one line of at most ${TITLE_MAX} characters`)
  }
  return v.trim()
}

export const WORKSPACE_OPS: OpTable = {
  "tab.split": {
    kind: "write",
    destructive: true,
    wraps: "rove api tab-split",
    async run(a, { api }) {
      const action = oneOf(a, "action", ["open", "close", "rename", "reset"])
      const leaf = leafId(a)
      if (action !== "open" && !leaf) throw new BridgeError("BAD_ARGS", `leafId is required to ${action}`)
      const cols = optInt(a, "cols", 1, 1000)
      const rows = optInt(a, "rows", 1, 500)
      if ((cols === undefined) !== (rows === undefined)) throw new BridgeError("BAD_ARGS", "cols and rows go together")
      const argv = [flag("task-id", taskId(a)), flag("tab", tabId(a)), flag("action", action)]
      if (leaf) argv.push(flag("leaf", leaf))
      if (action === "open") argv.push(flag("direction", optOneOf(a, "direction", ["right", "down"]) ?? "right"))
      if (action === "rename") argv.push(flag("title", paneTitle(a)))
      if (cols !== undefined && rows !== undefined) argv.push(flag("cols", cols), flag("rows", rows))
      const res = await api.verb<{ leaf: string; changed: boolean; split: unknown }>("tab-split", argv)
      return { leaf: res.leaf, changed: res.changed, split: res.split }
    },
  },
}
