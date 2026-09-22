/**
 * Durable field notes (docs/design/dispatcher.md), keyed by git common-dir so
 * a checkout and its worktrees share one record (the {@link IssuesStore} key
 * convention).
 *
 * Append + delete, no edit: a note was true when verified, but can STOP being
 * true, and the newest 15 are injected into every fresh session on the repo;
 * {@link NotesStore.remove} is the correction. The newest
 * {@link NOTES_RETENTION_CAP} per repo survive; that ring is the whole
 * eviction policy.
 */

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"
import { serialized, writeJsonAtomic } from "./json-file.ts"
import { resolveRepoRoot } from "./repo-key.ts"

/** Newest-N kept per repo. Older notes are dropped on write. */
export const NOTES_RETENTION_CAP = 50

export interface FieldNote {
  /** Per-repo id, stable for the note's life; what `note.delete` names (position shifts). */
  readonly id: number
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

export function defaultNotesStorePath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "notes.json")
}

function normalizeNote(entry: unknown): FieldNote | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null
  const raw = entry as Record<string, unknown>
  if (typeof raw.text !== "string" || raw.text.length === 0) return null
  return {
    // 0 = "needs an id" for {@link withIds}; real ids start at 1.
    id: typeof raw.id === "number" && Number.isSafeInteger(raw.id) && raw.id > 0 ? raw.id : 0,
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

/**
 * Fill in ids for notes stored without one. Oldest-first and deterministic:
 * the same file yields the same ids whether or not a write persisted them.
 */
function withIds(notes: FieldNote[]): FieldNote[] {
  let next = notes.reduce((max, n) => (n.id > max ? n.id : max), 0) + 1
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i]
    if (note && note.id === 0) notes[i] = { ...note, id: next++ }
  }
  return notes
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
          notes: withIds(
            Array.isArray(record.notes)
              ? record.notes.map(normalizeNote).filter((n): n is FieldNote => n !== null)
              : [],
          ),
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

  /** Prepend one note, evicting past {@link NOTES_RETENTION_CAP}; returns it with its allocated id. */
  async append(repo: string, note: Omit<FieldNote, "id">): Promise<FieldNote> {
    const { repoRoot, repoKey } = await resolveRepo(repo)
    return serialized(this.path, async () => {
      const store = await readStore(this.path)
      const record = store.repos[repoKey] ?? { repoRoot, notes: [] }
      // Max over the SURVIVING notes: eviction drops the tail, so a counter
      // derived from length would reissue ids the newest notes still hold.
      const id = record.notes.reduce((max, n) => (n.id > max ? n.id : max), 0) + 1
      const stored: FieldNote = { ...note, id }
      record.repoRoot = repoRoot
      record.notes = [stored, ...record.notes].slice(0, NOTES_RETENTION_CAP)
      store.repos[repoKey] = record
      await writeJsonAtomic(this.path, store)
      return stored
    })
  }

  /** False for an unknown id or repo, or a note the ring already evicted. */
  async remove(repo: string, id: number): Promise<boolean> {
    const { repoKey } = await resolveRepo(repo)
    return serialized(this.path, async () => {
      const store = await readStore(this.path)
      const record = store.repos[repoKey]
      if (!record) return false
      const next = record.notes.filter((n) => n.id !== id)
      if (next.length === record.notes.length) return false
      record.notes = next
      store.repos[repoKey] = record
      await writeJsonAtomic(this.path, store)
      return true
    })
  }
}
