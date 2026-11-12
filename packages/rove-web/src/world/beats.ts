/**
 * Tool calls as world beats: one beat per call, once, in the order the conversation wrote them.
 * The page learns a call from a polled `output.read` page (`RawMessage`), and a poll that lands
 * while the previous one is still in view returns the same calls again — the call id is the
 * dedupe key, so re-reading a page never replays a beat.
 */

import { type RawMessage, toolSummary } from "../transcript-data.ts"

export interface Beat {
  readonly id: string
  readonly name: string
  /** The one argument that says what the call did: a command, a path, a pattern. */
  readonly summary: string
  /** The file the call touched, when its input names one. */
  readonly file: string
  /** When this page learned of it (ms epoch); the engine's own timestamps are per message, not per call. */
  readonly at: number
}

const FILE_KEYS = ["file_path", "path", "notebook_path", "file"]

function fileOf(input: unknown): string {
  if (!input || typeof input !== "object") return ""
  for (const key of FILE_KEYS) {
    const value = Reflect.get(input, key)
    if (typeof value === "string" && value.trim()) return value
  }
  return ""
}

/** The file's last two segments: enough to know it in a list, short enough for a panel. */
export function shortFile(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.slice(-2).join("/") || path
}

/**
 * A bounded, de-duplicated log of the calls this page has seen. `ingest` returns only the new
 * ones, oldest first, so a poll can animate exactly what it has not animated before.
 */
export class BeatLog {
  private readonly seen = new Set<string>()
  private readonly beats: Beat[] = []

  constructor(readonly capacity = 400) {}

  ingest(messages: readonly RawMessage[], at: number): readonly Beat[] {
    const fresh: Beat[] = []
    for (const message of messages) {
      for (const block of message.blocks ?? []) {
        if (block.type !== "tool_call") continue
        const name = block.name?.trim() || "tool"
        const summary = toolSummary(block.input)
        const id = block.callId?.trim() || `${name}\u0000${summary}\u0000${at}`
        if (this.seen.has(id)) continue
        this.seen.add(id)
        const beat: Beat = { id, name, summary, file: fileOf(block.input), at }
        this.beats.push(beat)
        fresh.push(beat)
      }
    }
    if (this.beats.length > this.capacity) {
      for (const gone of this.beats.splice(0, this.beats.length - this.capacity)) this.seen.delete(gone.id)
    }
    return fresh
  }

  recent(limit = 6): readonly Beat[] {
    return this.beats.slice(-limit).reverse()
  }

  get count(): number {
    return this.beats.length
  }

  /** Zero the log (a new set of tasks): the next poll animates the calls still in view once more. */
  clear(): void {
    this.seen.clear()
    this.beats.length = 0
  }
}

/** How often each tool ran, newest-first by count then name — the world's "what this team uses" table. */
export function toolTally(beats: readonly Beat[], limit = 6): readonly { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const beat of beats) counts.set(beat.name, (counts.get(beat.name) ?? 0) + 1)
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** The files touched most, for the "hot files" panel. */
export function hotFiles(beats: readonly Beat[], limit = 6): readonly { file: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const beat of beats) if (beat.file) counts.set(beat.file, (counts.get(beat.file) ?? 0) + 1)
  return [...counts]
    .map(([file, count]) => ({ file: shortFile(file), count }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
    .slice(0, limit)
}
