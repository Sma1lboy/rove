/**
 * Prompt attachments (`<home>/.rove/attachments/`) are kept for `attachments.keepDays` days, 30 unless
 * set; 0 keeps them forever. An engine reads one by its path whenever a turn asks for it, so a file a
 * task, issue or routine still names is kept however old it is.
 */

import { readFileSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { promptAttachmentsDir, roveStateDir } from "@sma1lboy/rove-core/env.ts"
import { loadStateFile } from "@sma1lboy/rove-core/state/store.ts"

export const ATTACHMENT_KEEP_DAYS_KEY = "attachments.keepDays"
const DEFAULT_KEEP_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
/** Where a prompt outlives the composer: task prompts, issue bodies, routines and starts scheduled for later. */
const REFERENCE_FILES = ["tasks.json", "issues.json", "automations.json", "pending-starts.json"]
/** Names Rove gives the files it saves: `attach-` from web/phone uploads, `paste-` from a TUI image paste. */
const OWN_FILE = /^(?:attach|paste)-/

/** A whole number of days, 0 for "never delete"; anything else is the default. */
export function normalizeKeepDays(value: unknown): number {
  const n =
    typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_KEEP_DAYS
}

/**
 * Delete Rove's own `attach-*`/`paste-*` files older than `keepDays` that `references` does not name; returns what it
 * removed. Anything else in the directory is somebody else's and is left alone.
 */
export function sweepAttachments(opts: {
  readonly dir: string
  readonly keepDays: number
  readonly now: number
  /** Text of everything that may still point at an attachment. */
  readonly references: string
}): string[] {
  if (opts.keepDays === 0) return []
  let names: string[]
  try {
    names = readdirSync(opts.dir)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of names) {
    if (!OWN_FILE.test(name) || opts.references.includes(name)) continue
    const path = join(opts.dir, name)
    try {
      const stat = statSync(path)
      if (!stat.isFile() || opts.now - stat.mtimeMs < opts.keepDays * DAY_MS) continue
      unlinkSync(path)
      removed.push(name)
    } catch {
      // Gone or unreadable: the next sweep looks again.
    }
  }
  return removed
}

function readReferences(): string {
  // ponytail: a substring scan of four state files, once a day. Index by path if they grow past a few MB.
  return REFERENCE_FILES.map((file) => {
    try {
      return readFileSync(join(roveStateDir(), file), "utf8")
    } catch {
      return ""
    }
  }).join("\n")
}

/** Sweep now and once a day while the daemon runs; returns stop(). */
export function startAttachmentSweep(log: (line: string) => void = () => {}): () => void {
  const run = (): void => {
    const removed = sweepAttachments({
      dir: promptAttachmentsDir(),
      keepDays: normalizeKeepDays(loadStateFile()[ATTACHMENT_KEEP_DAYS_KEY]),
      now: Date.now(),
      references: readReferences(),
    })
    if (removed.length > 0) log(`removed ${removed.length} attachment(s) past ${ATTACHMENT_KEEP_DAYS_KEY}`)
  }
  run()
  const timer = setInterval(run, DAY_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
