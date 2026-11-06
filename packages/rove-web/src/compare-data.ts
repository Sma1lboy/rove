/** What the Compare page reads of a round: its attempts in order, each one's latest reply and changed files. */

import type { DiffFileRow, TaskRow } from "rove-bridge/protocol"

/** The slice of an `output.read` reply the excerpt reads: structured history when the engine has it, else the terminal tail. */
export interface OutputReply {
  readonly history?: {
    readonly messages?: ReadonlyArray<{
      readonly role?: string
      readonly timestamp?: string
      readonly blocks?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>
    }>
  }
  readonly terminal?: { readonly tail?: readonly string[] }
}

/** A `diff.files` reply. */
export interface DiffReply {
  readonly base: string | null
  readonly files: readonly DiffFileRow[]
}

/** A round's live attempts, in the order they were created (`#i/N` follows it). */
export function attemptsOf(rows: readonly TaskRow[], groupId: string): TaskRow[] {
  return rows
    .filter((row) => row.groupId === groupId)
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.title.localeCompare(b.title))
}

const EXCERPT_CHARS = 400
const TAIL_LINES = 6

/**
 * The attempt's latest assistant message, clipped; an engine without a history reader gives the last few
 * non-blank lines of its terminal instead. Null = nothing to show yet.
 */
export function replyExcerpt(reply: OutputReply): string | null {
  let latest: { at: string; text: string } | null = null
  for (const message of reply.history?.messages ?? []) {
    if (message.role !== "assistant") continue
    const text = (message.blocks ?? [])
      .flatMap((block) => (block.type === "text" && block.text ? [block.text] : []))
      .join("\n")
      .trim()
    const at = message.timestamp ?? ""
    if (text && (!latest || at > latest.at)) latest = { at, text }
  }
  const lines = (reply.terminal?.tail ?? []).map((line) => line.trimEnd()).filter((line) => line.trim() !== "")
  const text = latest?.text ?? lines.slice(-TAIL_LINES).join("\n")
  if (!text) return null
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS).trimEnd()}…` : text
}

export interface AttemptChanges {
  readonly scope: "working" | "branch"
  readonly files: readonly DiffFileRow[]
  readonly added: number
  readonly deleted: number
}

/** The uncommitted changes when there are any (an attempt still working), else what its branch holds over the base. */
export function attemptChanges(diff: DiffReply): AttemptChanges {
  const working = diff.files.filter((file) => file.scope === "working")
  const scope = working.length > 0 ? "working" : "branch"
  const files = scope === "working" ? working : diff.files.filter((file) => file.scope === "branch")
  return {
    scope,
    files,
    added: files.reduce((sum, file) => sum + (file.added ?? 0), 0),
    deleted: files.reduce((sum, file) => sum + (file.deleted ?? 0), 0),
  }
}
