import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"
import { logDaemonError } from "./crash-log.ts"
import { serialized, writeJsonAtomic } from "./json-file.ts"
import { gitTopLevel, resolveRepoRoot } from "./repo-key.ts"

const execFileAsync = promisify(execFile)

export type IssueStatus = "open" | "doing" | "hold" | "done"

export const ISSUE_STATUSES: readonly IssueStatus[] = ["open", "doing", "hold", "done"]

/**
 * Machine-stable marker for "that issue id is not in this repo's store",
 * carried as a `CODE: ` message prefix because an error's `name` does not
 * survive the RPC wire. The CLI boundary lifts it into the error envelope's
 * `code`, so a scripted caller can tell a stale issue id from a transport
 * failure instead of reading both as `RPC_ERROR`.
 */
const ISSUE_NOT_FOUND_CODE = "ISSUE_NOT_FOUND"

/**
 * Same wire trick for "this repo's record is shaped in a way this read did not
 * understand at all". Reads stay soft (the entries are counted into
 * {@link RepoIssues.skipped}); WRITES refuse, because a whole-file write can
 * only re-emit what it parsed, and everything it did not parse would be gone.
 */
const ISSUE_STORE_UNREADABLE_CODE = "ISSUE_STORE_UNREADABLE"

export interface Issue {
  id: number
  title: string
  status: IssueStatus
  created: string
  body: string
  /** Linked task ULID — set when a task is spawned from this issue (link op). */
  taskId?: string
}

export interface RepoIssues {
  repoRoot: string
  exists: boolean
  nextId: number
  issues: Issue[]
  /**
   * Entries in the file this read could not use — an issue whose `id` is not
   * a number is dropped by {@link normalizeIssue}. Non-zero means the store
   * holds stories this response does NOT list, so a short `issues` array is
   * not the whole board. `0` is the only value that means "you have it all".
   */
  skipped: number
}

interface RepoIssueRecord {
  repoRoot: string
  nextId: number
  issues: Issue[]
  /**
   * Raw `issues` entries {@link normalizeIssue} rejected, kept verbatim and
   * re-emitted by {@link serializeRecord} on every write. A normalizing read
   * feeding a whole-file write used to ERASE from disk what it merely could
   * not list, so `skipped` documented a recovery window one mutation wide.
   */
  unusable: readonly unknown[]
  /**
   * The record's `issues` was not an array, so this read parsed NOTHING here.
   * Holds the whole original record so a write triggered by a sibling repo
   * round-trips it untouched; a write aimed at THIS repo refuses instead.
   */
  unreadable?: { readonly raw: unknown }
}

interface IssuesStoreFile {
  version: 1
  repos: Record<string, RepoIssueRecord>
}

type IssueOp =
  | { type: "create"; title?: unknown; body?: unknown }
  | { type: "setStatus"; id?: unknown; status?: unknown }
  | { type: "update"; id?: unknown; title?: unknown; body?: unknown; taskId?: unknown }
  | { type: "link"; id?: unknown; taskId?: unknown }
  | { type: "unlink"; id?: unknown }
  | { type: "delete"; id?: unknown }

function isGitNotRepositoryError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes("not a git repository")
}

export function defaultIssuesStorePath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "issues.json")
}

function isValidStatus(value: unknown): value is IssueStatus {
  return typeof value === "string" && (ISSUE_STATUSES as readonly string[]).includes(value)
}

function normalizeIssue(entry: unknown): Issue | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null
  const raw = entry as Record<string, unknown>
  if (typeof raw.id !== "number") return null
  return {
    id: raw.id,
    title: typeof raw.title === "string" ? raw.title : "(untitled)",
    status: isValidStatus(raw.status) ? raw.status : "open",
    created: typeof raw.created === "string" ? raw.created : "",
    body: typeof raw.body === "string" ? raw.body : "",
    taskId: typeof raw.taskId === "string" ? raw.taskId : undefined,
  }
}

/** One read of the store file, plus what that read had to throw away. */
interface StoreRead {
  readonly file: IssuesStoreFile
  /** repoKey → number of unusable issue entries this read dropped. */
  readonly skipped: ReadonlyMap<string, number>
}

function emptyStore(): IssuesStoreFile {
  return { version: 1, repos: {} }
}

/**
 * Where to resume allocating ids when the file's `nextId` is unusable.
 * Falling back to `1` hands `create` an id that ALREADY EXISTS in the same
 * file — two cards, same number, and every id-keyed op (setStatus/update/
 * delete) then hits whichever one `find` reaches first. Scans the RAW entries
 * so even an id we could not parse into an issue still pushes the allocation
 * point past itself.
 */
function nextIdFallback(entries: readonly unknown[]): number {
  let max = 0
  for (const entry of entries) {
    const id = Number((entry as { id?: unknown } | null | undefined)?.id)
    if (Number.isFinite(id) && id > max) max = Math.trunc(id)
  }
  return max + 1
}

function todayStamp(): string {
  // KOBE_ISSUES_TODAY pins the stamp for visual-fixture determinism: the
  // Kanban screenshot gate renders `created` on every card, so a real clock
  // shifts the snapshot at each midnight. Never set in production.
  const pinned = process.env.KOBE_ISSUES_TODAY
  if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

async function resolveRepo(raw: unknown): Promise<{ repoRoot: string; repoKey: string }> {
  if (typeof raw !== "string" || raw.length === 0) throw new Error("repoRoot is required")
  try {
    const { repoRoot, repoKey } = await resolveRepoRoot(raw)
    // No worktree line at all still has a readable root: fall back to the
    // toplevel rather than refuse the repo.
    return { repoRoot: repoRoot ?? (await gitTopLevel(resolve(raw))), repoKey }
  } catch (err) {
    if (isGitNotRepositoryError(err)) throw new Error("repoRoot is not a git repository")
    throw err
  }
}

/** How many stories a non-array `issues` is hiding — the values of a map-shaped
 *  record, else the one value we cannot count into. Never `0`: `skipped: 0` is
 *  the single value {@link RepoIssues.skipped} documents as "you have it all". */
function unreadableCount(raw: unknown): number {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) return Math.max(1, Object.keys(raw).length)
  return 1
}

function readRecord(value: object): { record: RepoIssueRecord; dropped: number } {
  const record = value as Partial<RepoIssueRecord> & { issues?: unknown }
  const base = {
    repoRoot: typeof record.repoRoot === "string" ? record.repoRoot : "",
    nextId: typeof record.nextId === "number" ? record.nextId : 1,
  }
  if (record.issues !== undefined && !Array.isArray(record.issues)) {
    // `entries = []` used to make `dropped` come out `0` here — the read had
    // thrown away every story and reported the value that means it threw away
    // none. Then the next write persisted the emptiness.
    return {
      record: { ...base, issues: [], unusable: [], unreadable: { raw: value } },
      dropped: unreadableCount(record.issues),
    }
  }
  const entries: readonly unknown[] = Array.isArray(record.issues) ? record.issues : []
  const issues = entries.map(normalizeIssue).filter((issue): issue is Issue => issue !== null)
  const unusable = entries.filter((entry) => normalizeIssue(entry) === null)
  return {
    record: {
      repoRoot: base.repoRoot,
      nextId: typeof record.nextId === "number" ? record.nextId : nextIdFallback(entries),
      issues,
      unusable,
    },
    dropped: unusable.length,
  }
}

async function readStore(path: string): Promise<StoreRead> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<IssuesStoreFile>
    const repos: Record<string, RepoIssueRecord> = {}
    const skipped = new Map<string, number>()
    if (raw.repos && typeof raw.repos === "object") {
      for (const [key, value] of Object.entries(raw.repos)) {
        if (!value || typeof value !== "object") continue
        const { record, dropped } = readRecord(value)
        // Dropping silently is what made a filed story stop existing in every
        // read while still sitting in the file. Count it here so `list` can
        // say so, and log it so the daemon log names the repo.
        if (dropped > 0) {
          skipped.set(key, dropped)
          const why = record.unreadable ? '"issues" is not an array' : "id is not a number"
          logDaemonError(
            "issues-store-read",
            new Error(`${key}: dropped ${dropped} unreadable issue entr${dropped === 1 ? "y" : "ies"} (${why})`),
          )
        }
        repos[key] = record
      }
    }
    return { file: { version: 1, repos }, skipped }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { file: emptyStore(), skipped: new Map() }
    // A syntactically broken store already fails loudly and leaves the file
    // intact — but the CLI envelope showed only the parser's complaint, which
    // names neither the file nor the repo, so an agent could not say which
    // store to open.
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** File shape for one record: the issues this read understood, followed by the
 *  raw entries it did not. An unreadable record round-trips whole. */
function serializeRecord(record: RepoIssueRecord): unknown {
  if (record.unreadable) return record.unreadable.raw
  return { repoRoot: record.repoRoot, nextId: record.nextId, issues: [...record.issues, ...record.unusable] }
}

async function writeStore(path: string, store: IssuesStoreFile): Promise<void> {
  const repos: Record<string, unknown> = {}
  for (const [key, record] of Object.entries(store.repos)) repos[key] = serializeRecord(record)
  await writeJsonAtomic(path, { version: store.version, repos })
}

function response(repoRoot: string, record: RepoIssueRecord | null, skipped = 0): RepoIssues {
  return {
    repoRoot,
    exists: record !== null,
    nextId: record?.nextId ?? 1,
    issues: record?.issues ?? [],
    skipped,
  }
}

export class IssuesStore {
  constructor(private readonly path = defaultIssuesStorePath()) {}

  async list(repo: unknown): Promise<RepoIssues> {
    const { repoRoot, repoKey } = await resolveRepo(repo)
    return serialized(this.path, async () => {
      const { file: store, skipped } = await readStore(this.path)
      const record = store.repos[repoKey] ?? null
      if (record && !record.unreadable && record.repoRoot !== repoRoot) {
        record.repoRoot = repoRoot
        await writeStore(this.path, store)
      }
      return response(repoRoot, record, skipped.get(repoKey) ?? 0)
    })
  }

  /**
   * Every repo root this store holds a record for. The board derived its
   * sections from the TASK index, so landing the work and deleting the task —
   * the ordinary end of the loop — took the whole backlog off screen, and a
   * story filed with `issue-create --repo <path>` into a repo that never had a
   * task was invisible from the moment it was filed. A repo the store knows
   * about is a repo with a backlog; that is what a board section means.
   */
  async repos(): Promise<readonly string[]> {
    return serialized(this.path, async () => {
      const { file } = await readStore(this.path)
      return Object.values(file.repos)
        .map((record) => record.repoRoot)
        .filter((root) => root.length > 0)
    })
  }

  /**
   * Mirror a task→done transition onto its linked issue, atomically. The link
   * is owned by the issue (`Issue.taskId`), so we reverse-look-up the issue
   * whose `taskId` is this task and flip it to `done` — all inside ONE lock, so
   * a concurrent reopen (another surface flipping the same issue back to
   * open/doing between a separate read and write) can't be clobbered by a stale
   * decision. Returns the updated state when a not-already-done linked issue was
   * found and flipped, else `null` (nothing to mirror — no record, no linked
   * issue, or it's already done).
   */
  async mirrorTaskDone(repo: unknown, taskId: string): Promise<RepoIssues | null> {
    const { repoRoot, repoKey } = await resolveRepo(repo)
    if (!taskId) return null
    return serialized(this.path, async () => {
      const { file: store, skipped } = await readStore(this.path)
      const record = store.repos[repoKey]
      if (!record) return null
      const issue = record.issues.find((i) => i.taskId === taskId)
      if (!issue || issue.status === "done") return null
      issue.status = "done"
      record.repoRoot = repoRoot
      await writeStore(this.path, store)
      return response(repoRoot, record, skipped.get(repoKey) ?? 0)
    })
  }

  /**
   * Drop the link from whatever issue points at `taskId` — the reverse of the
   * `link` op, fired when the task itself is deleted. Without it the link
   * outlives its task and `issueColumnKey` parks the card in In progress
   * forever with no gesture to recover it.
   *
   * Same shape as {@link mirrorTaskDone}: one lock, reverse look-up on
   * `Issue.taskId`, `null` when there is nothing to unlink.
   */
  async unlinkTask(repo: unknown, taskId: string): Promise<RepoIssues | null> {
    const { repoRoot, repoKey } = await resolveRepo(repo)
    if (!taskId) return null
    return serialized(this.path, async () => {
      const { file: store, skipped } = await readStore(this.path)
      const record = store.repos[repoKey]
      if (!record) return null
      const issue = record.issues.find((i) => i.taskId === taskId)
      if (!issue) return null
      issue.taskId = undefined
      record.repoRoot = repoRoot
      await writeStore(this.path, store)
      return response(repoRoot, record, skipped.get(repoKey) ?? 0)
    })
  }

  async mutate(repo: unknown, op: unknown): Promise<RepoIssues> {
    const { repoRoot, repoKey } = await resolveRepo(repo)
    if (!op || typeof op !== "object" || Array.isArray(op) || typeof (op as { type?: unknown }).type !== "string") {
      throw new Error("missing op")
    }
    return serialized(this.path, async () => {
      const { file: store, skipped } = await readStore(this.path)
      let record = store.repos[repoKey]
      if (!record) {
        record = { repoRoot, nextId: 1, issues: [], unusable: [] }
        store.repos[repoKey] = record
      }
      if (record.unreadable) {
        // Every write here is a whole-file write of what the read produced.
        // This record produced nothing, so applying the op would replace the
        // stories still in the file with just the op's result. Naming the file
        // and the repo is the difference between a refusal an agent can act on
        // and one it can only report.
        throw new Error(
          `${ISSUE_STORE_UNREADABLE_CODE}: ${repoRoot}'s record in ${this.path} has a non-array "issues" — refusing to write over stories this build cannot read`,
        )
      }
      record.repoRoot = repoRoot
      const typed = op as IssueOp
      if (typed.type === "create") {
        if (typeof typed.title !== "string" || typed.title.trim().length === 0) {
          throw new Error("create requires a non-empty title")
        }
        if (typed.body !== undefined && typeof typed.body !== "string") throw new Error("body must be a string")
        record.issues = [
          {
            id: record.nextId,
            title: typed.title,
            status: "open",
            created: todayStamp(),
            body: typeof typed.body === "string" ? typed.body : "",
          },
          ...record.issues,
        ]
        record.nextId += 1
      } else if (typed.type === "setStatus") {
        if (typeof typed.id !== "number") throw new Error("setStatus requires a numeric id")
        if (!isValidStatus(typed.status)) throw new Error(`invalid status: must be one of ${ISSUE_STATUSES.join(", ")}`)
        const issue = record.issues.find((i) => i.id === typed.id)
        if (!issue) throw new Error(`${ISSUE_NOT_FOUND_CODE}: no issue #${typed.id}`)
        issue.status = typed.status
      } else if (typed.type === "update") {
        if (typeof typed.id !== "number") throw new Error("update requires a numeric id")
        if (typed.title !== undefined && (typeof typed.title !== "string" || typed.title.trim().length === 0)) {
          throw new Error("title must be a non-empty string")
        }
        if (typed.body !== undefined && typeof typed.body !== "string") throw new Error("body must be a string")
        // The link rides the SAME locked write as title/body: a string links,
        // `null` unlinks, absent leaves the link alone. `issue-update --title X
        // --task <bogus>` was two RPCs, so the rename committed and only then
        // did the link fail — a total-failure error for a half-applied command.
        // Nothing in this branch reaches disk until the `writeStore` at the
        // end of `mutate`, and the record it edits was parsed fresh from the
        // file, so ANY throw here leaves the store byte-for-byte unchanged.
        if (
          typed.taskId !== undefined &&
          typed.taskId !== null &&
          (typeof typed.taskId !== "string" || typed.taskId.length === 0)
        ) {
          throw new Error("taskId must be a non-empty string or null")
        }
        const issue = record.issues.find((i) => i.id === typed.id)
        if (!issue) throw new Error(`${ISSUE_NOT_FOUND_CODE}: no issue #${typed.id}`)
        if (typeof typed.title === "string") issue.title = typed.title
        if (typeof typed.body === "string") issue.body = typed.body
        if (typed.taskId !== undefined) issue.taskId = typed.taskId === null ? undefined : (typed.taskId as string)
      } else if (typed.type === "link") {
        if (typeof typed.id !== "number") throw new Error("link requires a numeric id")
        if (typeof typed.taskId !== "string" || typed.taskId.length === 0) {
          throw new Error("link requires a non-empty taskId")
        }
        const issue = record.issues.find((i) => i.id === typed.id)
        if (!issue) throw new Error(`${ISSUE_NOT_FOUND_CODE}: no issue #${typed.id}`)
        issue.taskId = typed.taskId
      } else if (typed.type === "unlink") {
        if (typeof typed.id !== "number") throw new Error("unlink requires a numeric id")
        const issue = record.issues.find((i) => i.id === typed.id)
        if (!issue) throw new Error(`${ISSUE_NOT_FOUND_CODE}: no issue #${typed.id}`)
        issue.taskId = undefined
      } else if (typed.type === "delete") {
        if (typeof typed.id !== "number") throw new Error("delete requires a numeric id")
        const nextIssues = record.issues.filter((i) => i.id !== typed.id)
        if (nextIssues.length === record.issues.length)
          throw new Error(`${ISSUE_NOT_FOUND_CODE}: no issue #${typed.id}`)
        record.issues = nextIssues
      } else {
        throw new Error(`unknown op type: ${(typed as { type: string }).type}`)
      }
      await writeStore(this.path, store)
      return response(repoRoot, record, skipped.get(repoKey) ?? 0)
    })
  }
}
