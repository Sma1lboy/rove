import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { isJsonlLineWithinBound, readFirstLineBounded, readTextFileBounded } from "../file-bounds"
import { sameHistoryWorktree } from "../history-worktree"
import { vendorConfigHome } from "../vendor-home"

export interface HistoryDeps {
  sessionsDir(): string
  readdir(p: string): Promise<string[]>
  readFile(p: string): Promise<string>
  readHead?(p: string): Promise<string>
  stat(p: string): Promise<FileStamp>
}

interface FileStamp {
  mtimeMs: number
  size?: number
  ctimeMs?: number
  ino?: number
  dev?: number
  isFile?(): boolean
}

export const defaultHistoryDeps: HistoryDeps = {
  sessionsDir: () => path.join(vendorConfigHome("codex"), "sessions"),
  readdir: (p) => readdir(p),
  readFile: readTextFileBounded,
  readHead: readFirstLineBounded,
  stat,
}

const UUID_AT_END = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IO_CONCURRENCY = 8

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size && a.ctimeMs === b.ctimeMs && a.ino === b.ino && a.dev === b.dev
}

/** Only the first nonblank line can be session_meta; malformed metadata is retried. */
export function rolloutCwd(raw: string): string {
  for (const line of raw.split("\n")) {
    if (!isJsonlLineWithinBound(line)) return ""
    if (!line.trim()) continue
    try {
      const record: unknown = JSON.parse(line)
      if (typeof record !== "object" || record === null || !("type" in record) || record.type !== "session_meta")
        return ""
      if (!("payload" in record) || typeof record.payload !== "object" || record.payload === null) return ""
      return "cwd" in record.payload && typeof record.payload.cwd === "string" ? record.payload.cwd : ""
    } catch {
      return ""
    }
  }
  return ""
}

interface SessionFile {
  path: string
  sessionId: string
  cwd: string
  stamp: FileStamp
}

/** Date-tree listings and cwd headers share one lifetime per reader and vendor home. */
class RolloutCatalog {
  private directories = new Map<string, { stamp: FileStamp; names: string[] }>()
  private metadata = new Map<string, SessionFile>()
  private located = new Map<string, string>()
  private refreshing: Promise<SessionFile[]> | undefined

  constructor(
    readonly root: string,
    private readonly deps: HistoryDeps,
  ) {}

  private async names(dir: string): Promise<string[]> {
    const stamp = await this.deps.stat(dir).catch(() => null)
    const hit = this.directories.get(dir)
    if (!stamp) {
      this.directories.delete(dir)
      return []
    }
    // Minimal injected stats do not describe directory identity; list afresh.
    if (stamp?.ctimeMs !== undefined && hit && sameStamp(hit.stamp, stamp)) return hit.names
    let names: string[]
    try {
      names = (await this.deps.readdir(dir)).sort().reverse()
    } catch {
      // Keep a previous successful listing, without blessing the failed stamp.
      return hit?.names ?? []
    }
    if (stamp) this.directories.set(dir, { stamp, names })
    return names
  }

  async *files(): AsyncGenerator<string> {
    const visited = new Set<string>([this.root])
    for (const year of await this.names(this.root)) {
      if (!/^\d{4}$/.test(year)) continue
      const yp = path.join(this.root, year)
      visited.add(yp)
      for (const month of await this.names(yp)) {
        if (!/^(0[1-9]|1[0-2])$/.test(month)) continue
        const mp = path.join(yp, month)
        visited.add(mp)
        for (const day of await this.names(mp)) {
          if (!/^(0[1-9]|[12]\d|3[01])$/.test(day)) continue
          const dp = path.join(mp, day)
          visited.add(dp)
          for (const name of await this.names(dp)) {
            if (name.startsWith("rollout-") && name.endsWith(".jsonl")) yield path.join(dp, name)
          }
        }
      }
    }
    for (const dir of this.directories.keys()) if (!visited.has(dir)) this.directories.delete(dir)
  }

  async locate(sessionId: string): Promise<string | undefined> {
    if (!FULL_UUID.test(sessionId)) return undefined
    const id = sessionId.toLowerCase()
    const hit = this.located.get(id)
    if (hit && (await this.isFile(hit))) return hit
    this.located.delete(id)
    for await (const file of this.files()) {
      if (path.basename(file).match(UUID_AT_END)?.[1]?.toLowerCase() !== id || !(await this.isFile(file))) continue
      // Bound lookup memo size, never the results of a search.
      if (this.located.size >= 256) {
        const oldest = this.located.keys().next().value
        if (oldest !== undefined) this.located.delete(oldest)
      }
      this.located.set(id, file)
      return file
    }
    return undefined
  }

  private async isFile(file: string): Promise<boolean> {
    const info = await this.deps.stat(file).catch(() => null)
    return info !== null && (info.isFile?.() ?? true)
  }

  sessions(): Promise<SessionFile[]> {
    if (!this.refreshing)
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = undefined
      })
    return this.refreshing
  }

  private async refresh(): Promise<SessionFile[]> {
    const next = new Map<string, SessionFile>()
    const files: string[] = []
    for await (const file of this.files()) files.push(file)
    let cursor = 0
    const readNext = async () => {
      while (cursor < files.length) {
        const file = files[cursor++]
        if (file === undefined) break
        const stamp = await this.deps.stat(file).catch(() => null)
        if (!stamp) continue
        const hit = this.metadata.get(file)
        if (hit && sameStamp(hit.stamp, stamp)) {
          next.set(file, hit)
          continue
        }
        const raw = await (this.deps.readHead ?? this.deps.readFile)(file).catch(() => "")
        const cwd = rolloutCwd(raw)
        const sessionId = path.basename(file).match(UUID_AT_END)?.[1]
        if (cwd && sessionId) next.set(file, { path: file, sessionId, cwd, stamp })
      }
    }
    await Promise.all(Array.from({ length: Math.min(IO_CONCURRENCY, files.length) }, readNext))
    this.metadata = next
    // Parallel reads must not change the creation ordering of the public list.
    return files.flatMap((file) => {
      const entry = next.get(file)
      return entry ? [entry] : []
    })
  }
}

const catalogs = new WeakMap<HistoryDeps, RolloutCatalog>()
function catalog(deps: HistoryDeps): RolloutCatalog {
  const root = deps.sessionsDir()
  let current = catalogs.get(deps)
  if (!current || current.root !== root) {
    current = new RolloutCatalog(root, deps)
    catalogs.set(deps, current)
  }
  return current
}

export async function listRolloutFiles(deps: HistoryDeps = defaultHistoryDeps): Promise<string[]> {
  const files: string[] = []
  for await (const file of catalog(deps).files()) files.push(file)
  return files
}

export function findRolloutFile(
  sessionId: string,
  deps: HistoryDeps = defaultHistoryDeps,
): Promise<string | undefined> {
  return catalog(deps).locate(sessionId)
}

export async function listSessionIdsForWorktree(
  worktree: string,
  deps: HistoryDeps = defaultHistoryDeps,
): Promise<string[]> {
  if (!worktree) return []
  return (await catalog(deps).sessions())
    .filter((file) => sameHistoryWorktree(file.cwd, worktree))
    .map((file) => file.sessionId)
    .reverse()
}

export async function findLatestRolloutForWorktree(
  worktree: string,
  deps: HistoryDeps = defaultHistoryDeps,
): Promise<{ path: string; mtimeMs: number } | null> {
  if (!worktree) return null
  let best: { path: string; mtimeMs: number } | null = null
  for (const file of await catalog(deps).sessions()) {
    if (sameHistoryWorktree(file.cwd, worktree) && (!best || file.stamp.mtimeMs > best.mtimeMs))
      best = { path: file.path, mtimeMs: file.stamp.mtimeMs }
  }
  return best
}
