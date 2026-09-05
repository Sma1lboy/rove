/**
 * Durable field notes (docs/design/dispatcher.md). v1 forwarded a note to the
 * repo's dispatcher seat and forgot it — the knowledge lived only in one
 * session's transcript, so the next worktree on the same repo rediscovered the
 * same gotcha. This store is the memory half: every filed note is appended
 * here, keyed by git common-dir so the source checkout and all its worktrees
 * share one record (the {@link IssuesStore} key convention).
 *
 * Append + delete, no edit: a note is a fact that WAS true when a session
 * verified it, so there is nothing to revise — but a fact can STOP being
 * true, and the newest 15 are injected into every fresh session on the repo,
 * which turns a stale note into something later agents act on. {@link
 * NotesStore.remove} is the correction; there is still no status verb to
 * argue about. Retention is a ring: the newest {@link NOTES_RETENTION_CAP}
 * survive per repo and older ones fall off. That cap is the whole eviction
 * policy; a repo whose notes genuinely outgrow it wants tagging and
 * retrieval, not a bigger number.
 */

import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"
import { serialized, writeJsonAtomic } from "./json-file.ts"
import { resolveRepoRoot } from "./repo-key.ts"

/** Newest-N kept per repo. Older notes are dropped on write. */
export const NOTES_RETENTION_CAP = 50

export interface FieldNote {
  /**
   * Per-repo id, allocated on append and stable for the note's life — what
   * `note.delete` names. Notes are prepended and evicted from the tail, so
   * position identifies nothing; a stale index would delete the wrong fact.
   */
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
    // 0 is the "needs an id" sentinel {@link withIds} fills in — real ids
    // start at 1, so no stored note can collide with it.
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
 * Fill in ids for notes stored before the field existed. Oldest-first, so a
 * later append never renumbers an existing note, and deterministic: the same
 * file always yields the same ids whether or not a write has persisted them.
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

  /**
   * Append one note, newest-first, evicting past {@link NOTES_RETENTION_CAP}.
   * The id is allocated HERE (max + 1 over what the repo currently holds) so
   * every caller gets one and none can mint a duplicate; the stored note is
   * returned so a caller can report the id it just created.
   */
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

  /**
   * Drop one note by id. Returns whether it was there — false for an unknown
   * id, an unknown repo, and a note already evicted by the retention ring.
   *
   * This is the one thing the v1 store deliberately lacked, and the gap
   * outlived its reasoning: a note IS a fact that was true when it was filed,
   * but the store is not an archive — the newest 15 are injected into every
   * fresh session on the repo, so a fact that has since stopped being true
   * keeps being handed to agents as if it still were. Append-only left
   * hand-editing the daemon's JSON as the only correction.
   */
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
