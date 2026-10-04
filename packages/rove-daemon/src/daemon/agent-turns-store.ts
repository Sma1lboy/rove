/**
 * Durable per-turn telemetry ({@link AgentTurnRecord}): joins engine turns to
 * task/tab/vendor and keeps them across restarts for `rove api agent-turns`.
 *
 * Every Stop re-reads the whole transcript, so turns dedupe by engine turn id;
 * last write wins (a later re-read is more complete).
 */

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"
import { samePath } from "../path-identity.ts"
import type { AgentTurnRecord } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import { serialized, writeJsonAtomic } from "./json-file.ts"
import { OWNER_ONLY_FILE_MODE } from "./owner-only.ts"

interface AgentTurnsFile {
  readonly version: 1
  readonly turns: AgentTurnRecord[]
}

/**
 * Newest kept. ~200 bytes/record → a few MB worst case, weeks of a busy machine.
 * ponytail: one flat cap, not per-task; revisit if a digest needs deeper history.
 */
const MAX_TURNS = 10_000

export function defaultAgentTurnsPath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "agent-turns.json")
}

function normalize(value: unknown): AgentTurnRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const t = value as Partial<AgentTurnRecord>
  if (typeof t.id !== "string" || t.id.length === 0) return null
  if (typeof t.taskId !== "string" || t.taskId.length === 0) return null
  if (typeof t.startedAt !== "number" || !Number.isFinite(t.startedAt)) return null
  if (typeof t.endedAt !== "number" || !Number.isFinite(t.endedAt)) return null
  return {
    id: t.id,
    taskId: t.taskId,
    ...(typeof t.tabId === "string" && t.tabId ? { tabId: t.tabId } : {}),
    ...(typeof t.vendor === "string" && t.vendor ? { vendor: t.vendor } : {}),
    ...(typeof t.sessionId === "string" && t.sessionId ? { sessionId: t.sessionId } : {}),
    ...(typeof t.model === "string" && t.model ? { model: t.model } : {}),
    ...(typeof t.repo === "string" && t.repo ? { repo: t.repo } : {}),
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    ...(t.usage && typeof t.usage === "object" ? { usage: t.usage } : {}),
  }
}

/** Engine turn ids are unique per session, not globally, so scope by task. */
function keyOf(turn: Pick<AgentTurnRecord, "taskId" | "id">): string {
  return `${turn.taskId}\0${turn.id}`
}

/** Both sides are {@link normalize} output (fixed key order), so this never
 *  misses a change; a reordered `usage` costs at most one harmless write. */
function sameRecord(a: AgentTurnRecord, b: AgentTurnRecord): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export class AgentTurnsStore {
  private readonly turns = new Map<string, AgentTurnRecord>()

  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    await this.enqueue(async () => {
      this.turns.clear()
      for (const turn of await this.read()) this.turns.set(keyOf(turn), turn)
    })
  }

  /** Returns how many were NEW; writes only if something was added or changed. */
  async record(turns: readonly AgentTurnRecord[]): Promise<number> {
    return await this.enqueue(async () => {
      let added = 0
      let changed = false
      for (const raw of turns) {
        const turn = normalize(raw)
        if (!turn) continue
        const key = keyOf(turn)
        const prev = this.turns.get(key)
        if (prev === undefined) added++
        // A changed re-read must reach disk too, not only new turns.
        else if (!sameRecord(prev, turn)) changed = true
        // Re-insert so Map order tracks recency; the cap evicts from the head.
        this.turns.delete(key)
        this.turns.set(key, turn)
      }
      if (added === 0 && !changed) return 0
      while (this.turns.size > MAX_TURNS) {
        const oldest = this.turns.keys().next().value
        if (oldest === undefined) break
        this.turns.delete(oldest)
      }
      await this.write()
      return added
    })
  }

  /** Newest-first, optionally filtered. `limit` bounds the answer. */
  list(filter: { taskId?: string; repo?: string; since?: number; limit?: number } = {}): AgentTurnRecord[] {
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 200
    const out: AgentTurnRecord[] = []
    for (const turn of this.turns.values()) {
      if (filter.taskId && turn.taskId !== filter.taskId) continue
      if (filter.repo && !samePath(turn.repo, filter.repo)) continue
      if (filter.since !== undefined && turn.endedAt < filter.since) continue
      out.push(turn)
    }
    out.sort((a, b) => b.endedAt - a.endedAt)
    return out.slice(0, limit)
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.enqueue(async () => {
      let changed = false
      for (const [key, turn] of this.turns) {
        if (turn.taskId !== taskId) continue
        this.turns.delete(key)
        changed = true
      }
      if (changed) await this.write()
    })
  }

  private async read(): Promise<AgentTurnRecord[]> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Partial<AgentTurnsFile>
      if (!Array.isArray(parsed.turns)) return []
      return parsed.turns.map(normalize).filter((t): t is AgentTurnRecord => t !== null)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
      logDaemonError("agent-turns-load", err)
      return []
    }
  }

  private async write(): Promise<void> {
    const body: AgentTurnsFile = { version: 1, turns: [...this.turns.values()] }
    try {
      // 0600: no credentials, but records name every repo you work in and when.
      await writeJsonAtomic(this.path, body, { mode: OWNER_ONLY_FILE_MODE, compact: true })
    } catch (err) {
      logDaemonError("agent-turns-write", err)
    }
  }

  /** Concurrent hook ingests must not interleave read-modify-write and lose turns. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    return serialized(this.path, work)
  }
}
