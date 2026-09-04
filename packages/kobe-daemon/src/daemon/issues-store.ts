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

async function readStore(path: string): Promise<StoreRead> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<IssuesStoreFile>
    const repos: Record<string, RepoIssueRecord> = {}
    const skipped = new Map<string, number>()
    if (raw.repos && typeof raw.repos === "object") {
      for (const [key, value] of Object.entries(raw.repos)) {
        if (!value || typeof value !== "object") continue
        const record = value as Partial<RepoIssueRecord>
        const entries: readonly unknown[] = Array.isArray(record.issues) ? record.issues : []
        const issues = entries.map(normalizeIssue).filter((issue): issue is Issue => issue !== null)
        // Dropping silently is what made a filed story stop existing in every
        // read while still sitting in the file. Count it here so `list` can
        // say so, and log it so the daemon log names the repo.
        const dropped = entries.length - issues.length
        if (dropped > 0) {
          skipped.set(key, dropped)
          logDaemonError(
            "issues-store-read",
            new Error(
              `${key}: dropped ${dropped} unreadable issue entr${dropped === 1 ? "y" : "ies"} (id is not a number)`,
            ),
          )
        }
        repos[key] = {
          repoRoot: typeof record.repoRoot === "string" ? record.repoRoot : "",
          nextId: typeof record.nextId === "number" ? record.nextId : nextIdFallback(entries),
          issues,
        }
      }
    }
    return { file: { version: 1, repos }, skipped }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { file: emptyStore(), skipped: new Map() }
    throw err
  }
}

async function writeStore(path: string, store: IssuesStoreFile): Promise<void> {
  await writeJsonAtomic(path, store)
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
      if (record && record.repoRoot !== repoRoot) {
        record.repoRoot = repoRoot
        await writeStore(this.path, store)
      }
      return response(repoRoot, record, skipped.get(repoKey) ?? 0)
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
        record = { repoRoot, nextId: 1, issues: [] }
        store.repos[repoKey] = record
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
