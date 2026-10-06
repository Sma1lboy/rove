/**
 * Read-only views of what agents did: a task's engine history (`read-output`), a repo's recent
 * work (`digest`) and per-turn telemetry (`agent-turns`). Each op is one verb with its flags
 * built from validated values.
 */

import { BridgeError, optInt } from "../protocol.ts"
import { absPath, flag, optOneOf, optText, tabId, taskId } from "./args.ts"
import type { Args, OpTable } from "./types.ts"

/** Cursors are opaque base64url-ish tokens the verb minted; anything else is not one of ours. */
const CURSOR = /^[A-Za-z0-9._~=-]{1,1024}$/

/** An optional filter the phone sent: absent, null and "" all mean "not given". */
function given(args: Args, name: string): boolean {
  const v = args[name]
  return v !== undefined && v !== null && v !== ""
}

function optCursor(args: Args): string | undefined {
  const raw = optText(args, "cursor", 1024)
  if (raw === undefined) return undefined
  if (!CURSOR.test(raw)) throw new BridgeError("BAD_ARGS", "cursor is not a read-output cursor")
  return raw
}

export const insightOps: OpTable = {
  "output.read": {
    kind: "read",
    destructive: false,
    wraps: "rove api read-output (structured engine history, else a labeled terminal tail)",
    run(args, { api }) {
      const argv = [flag("task-id", taskId(args))]
      if (given(args, "tab")) argv.push(flag("tab", tabId(args, "tab")))
      const source = optOneOf(args, "source", ["auto", "history", "terminal"] as const)
      if (source) argv.push(flag("source", source))
      const cursor = optCursor(args)
      if (cursor) argv.push(flag("cursor", cursor))
      const limit = optInt(args, "limit", 1, 50)
      if (limit !== undefined) argv.push(flag("limit", limit))
      return api.verb("read-output", argv)
    },
  },
  "repo.digest": {
    kind: "read",
    destructive: false,
    wraps: "rove api digest",
    run(args, { api }) {
      const argv = [flag("repo", absPath(args, "repo"))]
      const days = optInt(args, "sinceDays", 1, 365)
      if (days !== undefined) argv.push(flag("since-days", days))
      return api.verb("digest", argv)
    },
  },
  "turns.list": {
    kind: "read",
    destructive: false,
    wraps: "rove api agent-turns",
    run(args, { api }) {
      const argv: string[] = []
      if (given(args, "taskId")) argv.push(flag("task-id", taskId(args)))
      if (given(args, "repo")) argv.push(flag("repo", absPath(args, "repo")))
      const days = optInt(args, "sinceDays", 1, 365)
      if (days !== undefined) argv.push(flag("since-days", days))
      const limit = optInt(args, "limit", 1, 500)
      if (limit !== undefined) argv.push(flag("limit", limit))
      return api.verb("agent-turns", argv)
    },
  },
}
