/** The bridge's audit lines for destructive web actions: what, which ids, when, and who (`conn.who`). */

import type { Request } from "./protocol.ts"

/** Where a line goes, and the connection's `device=… from=…` tag. */
export interface AuditSink {
  readonly log?: (line: string) => void
  readonly who: string
}

/** Core ops that lose work or are hard to undo; area ops declare it on their spec. */
export const DESTRUCTIVE_CORE: Readonly<Record<string, true>> = {
  "task.delete": true,
  "task.land": true,
  "tab.close": true,
}

/**
 * Verbs that lose work or are hard to undo, audited like {@link DESTRUCTIVE_CORE}.
 * The token already grants a shell (`term.input`), so serving verbs adds no
 * power; the audit line is what keeps a destructive call visible.
 */
export const DESTRUCTIVE_VERBS: Readonly<Record<string, true>> = {
  delete: true,
  land: true,
  "remove-worktree": true,
  "tab-close": true,
  "issue-delete": true,
  "routine-delete": true,
  "note-delete": true,
}

export function logDestructiveVerb(sink: AuditSink, verb: string, params: Record<string, unknown>): void {
  const ids = ["task-id", "tab", "id"]
    .filter((key) => typeof params[key] === "string" || typeof params[key] === "number")
    .map((key) => `${key}=${String(params[key])}`)
  audit(sink, `api.invoke ${verb}`, ids)
}

/** Audit line for a destructive op: op name and the ids it targets. Never other args, never the token. */
export function logDestructive(sink: AuditSink, req: Request): void {
  const ids = ["taskId", "tabId", "path"]
    .filter((key) => typeof req.args[key] === "string")
    .map((key) => `${key}=${String(req.args[key])}`)
  audit(sink, req.op, ids)
}

/** When and by whom, so a line can be matched to the daemon's `task-deletion-audit` and to a device to revoke. */
function audit(sink: AuditSink, what: string, ids: readonly string[]): void {
  const line = `[rove-bridge] ${new Date().toISOString()} ${what} ${ids.join(" ")}`.trimEnd()
  ;(sink.log ?? ((l: string) => console.error(l)))(`${line} ${sink.who}`)
}
