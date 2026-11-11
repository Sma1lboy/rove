/**
 * Starts that wait for their time (`<ROVE_HOME>/.rove/pending-starts.json`): the web's "Later". A record says
 * what to create and what to tell it; nothing exists before `at`, when `scheduled-start.ts` creates the task
 * with its engine and prompt. The daemon is the only writer. A start that failed stays, with its error, until
 * the owner cancels it, so it never disappears unseen.
 */

import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ApiParams } from "@sma1lboy/rove-plugin-sdk/contract"
import { ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"
import { serialized, writeJsonAtomic } from "./json-file.ts"
import { OWNER_ONLY_FILE_MODE } from "./owner-only.ts"

/**
 * What to create when the start is due. `add`: the verb's flags as the caller would have passed them, the
 * prompt excepted. `dir`: a session in a directory (a project's own checkout), its project row first when
 * `project` is set.
 */
export type PendingStartCreate =
  | { readonly via: "add"; readonly params: ApiParams }
  | { readonly via: "dir"; readonly dir: string; readonly project: boolean; readonly vendor?: string }

export interface PendingStart {
  readonly id: string
  readonly at: string
  readonly prompt: string
  /** What the owner sees in the pending list. */
  readonly title: string
  /** The project (repo or directory) it belongs to, for the list. */
  readonly repo: string
  readonly create: PendingStartCreate
  readonly createdAt: string
  /** Set when the start ran and failed; a failed start is never due again. */
  readonly error?: string
}

export type NewPendingStart = Omit<PendingStart, "id" | "createdAt" | "error">

interface PendingStartsFile {
  readonly version: 1
  readonly starts: readonly PendingStart[]
}

export function defaultPendingStartsPath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "pending-starts.json")
}

function isStart(value: unknown): value is PendingStart {
  if (!value || typeof value !== "object") return false
  const s = value as Partial<PendingStart>
  const via = (s.create as { via?: unknown } | undefined)?.via
  return (
    typeof s.id === "string" &&
    typeof s.at === "string" &&
    typeof s.prompt === "string" &&
    typeof s.repo === "string" &&
    (via === "add" || via === "dir")
  )
}

export class PendingStartsStore {
  private starts: PendingStart[] = []

  constructor(private readonly path: string) {}

  /** A missing or unreadable file reads as no pending starts. */
  async init(): Promise<void> {
    const raw = await readFile(this.path, "utf8").catch(() => "")
    try {
      const parsed = JSON.parse(raw) as Partial<PendingStartsFile>
      this.starts = Array.isArray(parsed.starts) ? parsed.starts.filter(isStart) : []
    } catch {
      this.starts = []
    }
  }

  list(): readonly PendingStart[] {
    return [...this.starts].sort((a, b) => a.at.localeCompare(b.at))
  }

  /** Not failed and at or past its time. An unparseable time counts as due, so it fails rather than waits forever. */
  due(nowMs: number): readonly PendingStart[] {
    return this.list().filter((s) => {
      if (s.error !== undefined) return false
      const at = Date.parse(s.at)
      return !Number.isFinite(at) || at <= nowMs
    })
  }

  async add(input: NewPendingStart): Promise<PendingStart> {
    const start: PendingStart = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }
    await this.write(() => [...this.starts, start])
    return start
  }

  /** False when no such start exists (already fired or cancelled). */
  async remove(id: string): Promise<boolean> {
    if (!this.starts.some((s) => s.id === id)) return false
    await this.write(() => this.starts.filter((s) => s.id !== id))
    return true
  }

  /** Put a start back with what went wrong, so the owner sees it in the list. */
  async fail(start: PendingStart, error: string): Promise<void> {
    await this.write(() => [...this.starts.filter((s) => s.id !== start.id), { ...start, error }])
  }

  private write(next: () => PendingStart[]): Promise<void> {
    return serialized(this.path, async () => {
      this.starts = next()
      const body: PendingStartsFile = { version: 1, starts: this.starts }
      await writeJsonAtomic(this.path, body, { mode: OWNER_ONLY_FILE_MODE })
    })
  }
}
