/**
 * The five MAP channels, as a table.
 *
 * `usage.snapshot`, `usage.context`, `worktree.changes`,
 * `transcript.activity` and `task.tokens` all reduce to the same five lines:
 * parse the payload, drop it loudly if it is malformed (never clobbering a
 * good map with a bad frame), compare by VALUE, and write only on a real
 * change. Each had its own copy in the dispatcher, which is how one of them
 * ended up missing the equality gate for a while — an unchanged republish
 * (the bus replays every channel on every reconnect) swapping the map
 * reference and re-rendering every row that reads it.
 *
 * So the difference between them is the only thing this table states: which
 * parse, which comparison, and which cell. Adding a map channel is one row.
 */

import { logClientError } from "@sma1lboy/kobe-daemon/client/client-log"
import type { OrchestratorSignals } from "./remote-orchestrator-payloads.ts"
import {
  describePayload,
  parseContextUsagePayload,
  parseRowTokensPayload,
  parseTranscriptActivityPayload,
  parseUsageSnapshotPayload,
  parseWorktreeChangesPayload,
  sameContextUsageMap,
  sameRowTokenMap,
  sameTranscriptActivityMap,
  sameUsageSnapshotMap,
  sameWorktreeChangesMap,
} from "./remote-orchestrator-payloads.ts"

/** One map channel: its parse, its value equality, and its cell. */
interface MapChannel<T> {
  /** What the drop log calls the payload, e.g. "usage payload". */
  readonly what: string
  readonly parse: (payload: unknown) => T | null
  readonly same: (a: T, b: T) => boolean
  readonly read: (signals: OrchestratorSignals) => T | null
  readonly write: (signals: OrchestratorSignals, next: T) => void
}

// biome-ignore lint/suspicious/noExplicitAny: one table over five differently-typed maps; each row is internally consistent.
const MAP_CHANNELS: Readonly<Record<string, MapChannel<any>>> = {
  "usage.snapshot": {
    what: "usage payload",
    parse: parseUsageSnapshotPayload,
    same: sameUsageSnapshotMap,
    read: (signals) => signals.usageSnapshotAcc(),
    write: (signals, next) => signals.setUsageSnapshotSig(next),
  },
  "usage.context": {
    what: "context payload",
    parse: parseContextUsagePayload,
    same: sameContextUsageMap,
    read: (signals) => signals.contextUsageAcc(),
    write: (signals, next) => signals.setContextUsageSig(next),
  },
  "worktree.changes": {
    what: "changes payload",
    parse: parseWorktreeChangesPayload,
    same: sameWorktreeChangesMap,
    read: (signals) => signals.worktreeChangesAcc(),
    write: (signals, next) => signals.setWorktreeChangesSig(next),
  },
  "transcript.activity": {
    what: "activity payload",
    parse: parseTranscriptActivityPayload,
    same: sameTranscriptActivityMap,
    read: (signals) => signals.transcriptActivityAcc(),
    write: (signals, next) => signals.setTranscriptActivitySig(next),
  },
  "task.tokens": {
    // Written by a PLUGIN — the one publisher in the system Rove does not
    // ship — so a malformed frame is a third party's bug, and dropping it
    // loudly is the only honest answer.
    what: "token map",
    parse: parseRowTokensPayload,
    same: sameRowTokenMap,
    read: (signals) => signals.rowTokensAcc(),
    write: (signals, next) => signals.setRowTokensSig(next),
  },
}

/**
 * Handle a map channel, or report `false` for a name this table does not own
 * (the dispatcher then goes on to its other branches).
 */
export function handleMapChannel(name: string, payload: unknown, signals: OrchestratorSignals): boolean {
  const channel = MAP_CHANNELS[name]
  if (!channel) return false
  const next = channel.parse(payload)
  if (!next) {
    // Malformed → never clobber a good map, but log the drop.
    logClientError("orch", `dropped ${name} event: malformed ${channel.what} (${describePayload(payload)})`)
    return true
  }
  // Value-equality gate: an unchanged republish (a bus replay across a
  // reconnect, or a daemon publish that round-trips to the same values) must
  // not swap the map reference and re-render every reader of it.
  const current = channel.read(signals)
  if (current && channel.same(current, next)) return true
  channel.write(signals, next)
  return true
}
