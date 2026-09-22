/**
 * The MAP channels as a table: each row states only its parse, value
 * equality, and cell; {@link handleMapChannel} applies the shared rule (drop
 * malformed loudly, write only on a real change). Adding one is one row.
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
    // Published by a PLUGIN, so malformed frames are third-party bugs.
    what: "token map",
    parse: parseRowTokensPayload,
    same: sameRowTokenMap,
    read: (signals) => signals.rowTokensAcc(),
    write: (signals, next) => signals.setRowTokensSig(next),
  },
}

/** Handle a map channel; `false` for a name this table doesn't own. */
export function handleMapChannel(name: string, payload: unknown, signals: OrchestratorSignals): boolean {
  const channel = MAP_CHANNELS[name]
  if (!channel) return false
  const next = channel.parse(payload)
  if (!next) {
    // Malformed → never clobber a good map, but log the drop.
    logClientError("orch", `dropped ${name} event: malformed ${channel.what} (${describePayload(payload)})`)
    return true
  }
  // The bus replays every channel on reconnect; an unchanged republish must not
  // swap the map reference and re-render every reader.
  const current = channel.read(signals)
  if (current && channel.same(current, next)) return true
  channel.write(signals, next)
  return true
}
