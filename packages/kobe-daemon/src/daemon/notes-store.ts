/**
 * Durable field notes (docs/design/dispatcher.md). v1 forwarded a note to the
 * repo's dispatcher seat and forgot it — the knowledge lived only in one
 * session's transcript, so the next worktree on the same repo rediscovered the
 * same gotcha. This store is the memory half: every filed note is appended
 * here, keyed by git common-dir so the source checkout and all its worktrees
 * share one record (the {@link IssuesStore} key convention).
 *
 * Append-only by construction — a note is a fact that WAS true when a session
 * verified it, so there is no edit or status verb to argue about. Retention is
 * a ring: the newest {@link NOTES_RETENTION_CAP} survive per repo and older
 * ones fall off. That cap is the whole eviction policy; a repo whose notes
 * genuinely outgrow it wants tagging and retrieval, not a bigger number.
 */

import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { ROVE_STATE_DIR_BASENAME, readRoveEnv } from "../compat-env.ts"
import { serialized, writeJsonAtomic } from "./json-file.ts"
import { resolveRepoRoot } from "./repo-key.ts"

/** Newest-N kept per repo. Older notes are dropped on write. */
export const NOTES_RETENTION_CAP = 50

export interface FieldNote {
  /** ISO-8601 file time. */
  readonly at: string
  /** The verified one-line conclusion, verbatim as the author filed it. */
  readonly text: string
  /** Author task id — provenance, so a reader can go read the session. */
  readonly taskId: string
  /** Author task's display label at filing time (title, else branch). */
  readonly author: string
}

interface RepoNoteRecord {
  repoRoot: string
  notes: FieldNote[]
}

interface NotesStoreFile {
  version: 1
  repos: Record<string, RepoNoteRecord>
}

export function defaultNotesStorePath(homeDir = readRoveEnv("HOME_DIR") ?? homedir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "notes.json")
}

function normalizeNote(entry: unknown): FieldNote | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null
  const raw = entry as Record<string, unknown>
  if (typeof raw.text !== "string" || raw.text.length === 0) return null
  return {
    at: typeof raw.at === "string" ? raw.at : "",
    text: raw.text,
    taskId: typeof raw.taskId === "string" ? raw.taskId : "",
    author: typeof raw.author === "string" ? raw.author : "",
  }
}

async function resolveRepo(raw: string): Promise<{ repoRoot: string; repoKey: string }> {
  const { repoRoot, repoKey } = await resolveRepoRoot(raw)
  if (!repoRoot) throw new Error("repoRoot is not a git repository")
  return { repoRoot, repoKey }
}

async function readStore(path: string): Promise<NotesStoreFile> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<NotesStoreFile>
    const repos: Record<string, RepoNoteRecord> = {}
    if (raw.repos && typeof raw.repos === "object") {
      for (const [key, value] of Object.entries(raw.repos)) {
        if (!value || typeof value !== "object") continue
        const record = value as Partial<RepoNoteRecord>
        repos[key] = {
          repoRoot: typeof record.repoRoot === "string" ? record.repoRoot : "",
          notes: Array.isArray(record.notes)
            ? record.notes.map(normalizeNote).filter((n): n is FieldNote => n !== null)
            : [],
        }
      }
    }
    return { version: 1, repos }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, repos: {} }
    throw err
  }
}

export class NotesStore {
  constructor(private readonly path = defaultNotesStorePath()) {}

  /** Newest-first notes for a repo; empty for a repo that never filed one. */
  async list(repo: string): Promise<readonly FieldNote[]> {
    const { repoKey } = await resolveRepo(repo)
    return serialized(this.path, async () => (await readStore(this.path)).repos[repoKey]?.notes ?? [])
  }

  /** Append one note, newest-first, evicting past {@link NOTES_RETENTION_CAP}. */
  async append(repo: string, note: FieldNote): Promise<void> {
    const { repoRoot, repoKey } = await resolveRepo(repo)
    await serialized(this.path, async () => {
      const store = await readStore(this.path)
      const record = store.repos[repoKey] ?? { repoRoot, notes: [] }
      record.repoRoot = repoRoot
      record.notes = [note, ...record.notes].slice(0, NOTES_RETENTION_CAP)
      store.repos[repoKey] = record
      await writeJsonAtomic(this.path, store)
    })
  }
}
