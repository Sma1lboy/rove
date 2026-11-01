import { execFile } from "node:child_process"
import { promises as fs, statSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { WORKSPACE_CAPABILITIES } from "@sma1lboy/rove-daemon/workspace"
import { isRemoteRepoKey } from "../../state/repos.ts"
import { ForkUnsupportedError } from "../errors.ts"
import { CLONEFILEAT_PERL } from "../worktree/clone-ignored.ts"
import { worktreePathFor } from "../worktree/paths.ts"
import type { GitWorktreeBackend } from "./git-worktree.ts"
import type { DisposeTarget, MaterializeSpec, WorkspaceBackend, WorkspaceHandle } from "./types.ts"

const run = promisify(execFile)

/** Can `from`'s volume clone files into `toDir`? Injected so a test can stand in a volume that cannot. */
export type CloneProbe = (from: string, toDir: string) => Promise<boolean>

/** Clone each top-level `entries` path (absolute) into the directory `to`. Throws if any cannot be cloned. */
export type CloneEntries = (entries: readonly string[], to: string) => Promise<void>

export interface CowCloneDeps {
  readonly probe?: CloneProbe
  readonly cloneEntries?: CloneEntries
}

/** One `cp` per chunk keeps argv far below ARG_MAX on a repo with thousands of top-level entries. */
const CP_CHUNK = 200

/** `cp -c` is APFS clonefile(2); `--reflink=always` is FICLONE and fails instead of silently copying. */
function cloneFlags(): readonly string[] | null {
  if (process.platform === "darwin") return ["-c", "-R", "-P"]
  if (process.platform === "linux") return ["--reflink=always", "-a"]
  return null
}

const cpClone: CloneEntries = async (entries, to) => {
  const flags = cloneFlags()
  if (!flags) throw new ForkUnsupportedError(`copy-on-write clones are not supported on ${process.platform}`)
  for (let i = 0; i < entries.length; i += CP_CHUNK) {
    try {
      await run("cp", [...flags, ...entries.slice(i, i + CP_CHUNK), `${to}${path.sep}`])
    } catch (err) {
      const detail = (err as { stderr?: string }).stderr?.trim() || String(err)
      throw new Error(`cloning the worktree failed: ${detail}`)
    }
  }
}

const probeCache = new Map<string, Promise<boolean>>()

/**
 * One clone that must succeed or fail, never degrade: `cp -c` quietly copies when the volumes cannot clone
 * (macOS exits 0 across volumes), so the macOS probe calls clonefileat(2) itself, as clone-ignored.ts does.
 */
async function cloneOneFile(source: string, target: string): Promise<void> {
  if (process.platform === "darwin") await run("/usr/bin/perl", ["-e", CLONEFILEAT_PERL, source, target])
  else if (process.platform === "linux") await run("cp", ["--reflink=always", source, target])
  else throw new Error(`no clone primitive on ${process.platform}`)
}

/** Tries to clone one of the parent's own files into the destination; cached per source/destination volume pair. */
const volumeProbe: CloneProbe = (from, toDir) => {
  const key = `${statSync(from).dev}:${statSync(toDir).dev}`
  let known = probeCache.get(key)
  if (!known) {
    known = (async () => {
      // The worktree's `.git` file: tiny, always there, and read-only to us.
      const probe = path.join(toDir, `.rove-clone-probe-${process.pid}`)
      try {
        await cloneOneFile(path.join(from, ".git"), probe)
        return true
      } catch {
        return false
      } finally {
        await fs.rm(probe, { force: true })
      }
    })()
    probeCache.set(key, known)
  }
  return known
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run("git", [...args], { cwd, maxBuffer: 64 * 1024 * 1024 })
  return stdout.trim()
}

/**
 * A git worktree whose files are a copy-on-write clone of another task's worktree, so a fork keeps the parent's
 * uncommitted, staged and gitignored files. Cloning is near-instant and costs no disk until either side writes.
 * A materialisation without a fork source (a vanished directory coming back later) is a plain worktree on the
 * task's own branch: re-cloning the parent's present state into an old task would be wrong.
 */
export class CowCloneBackend implements WorkspaceBackend {
  readonly id = "cow-clone"
  readonly capabilities = WORKSPACE_CAPABILITIES["cow-clone"]
  private readonly probe: CloneProbe
  private readonly cloneEntries: CloneEntries

  constructor(
    private readonly plain: GitWorktreeBackend,
    deps: CowCloneDeps = {},
  ) {
    this.probe = deps.probe ?? volumeProbe
    this.cloneEntries = deps.cloneEntries ?? cpClone
  }

  async materialize(spec: MaterializeSpec): Promise<WorkspaceHandle> {
    const parent = spec.forkFrom
    if (!parent) return { ...(await this.plain.materialize(spec)), backend: this.id }
    if (isRemoteRepoKey(spec.repo)) throw new ForkUnsupportedError("a remote project's worktree cannot be cloned")
    const target = worktreePathFor(spec.repo, spec.slug)
    const root = path.dirname(target)
    await fs.mkdir(root, { recursive: true })
    if (!(await this.probe(parent, root))) {
      throw new ForkUnsupportedError(
        `${parent} and ${root} are not on one volume that can clone files (APFS, btrfs, XFS with reflink); the fork would have to copy the whole tree`,
      )
    }
    const head = await git(parent, ["rev-parse", "HEAD"])
    // No checkout: the tree comes from the clone, so the fork sees the parent's working files, not HEAD's.
    await git(spec.repo, ["worktree", "add", "--no-checkout", "-b", spec.branch, target, head])
    try {
      const entries = (await fs.readdir(parent))
        .filter((name) => name !== ".git")
        .map((name) => path.join(parent, name))
      await this.cloneEntries(entries, target)
      await this.carryIndex(parent, target)
    } catch (err) {
      await this.discard(spec.repo, target, spec.branch)
      throw err
    }
    return { backend: this.id, path: target }
  }

  /** The index is per worktree and lives in its gitdir: copying it keeps staged state, then refresh re-stats the cloned files. */
  private async carryIndex(parent: string, target: string): Promise<void> {
    const indexOf = (dir: string) => git(dir, ["rev-parse", "--path-format=absolute", "--git-path", "index"])
    try {
      await fs.copyFile(await indexOf(parent), await indexOf(target))
      await git(target, ["update-index", "-q", "--refresh"])
    } catch {
      // No usable index to carry: unstaged-but-present is still right, only staging is lost.
      await git(target, ["reset", "-q"])
    }
  }

  /** Undo this call's own half-built worktree and the branch it cut; nothing else of the user's is touched. */
  private async discard(repo: string, target: string, branch: string): Promise<void> {
    await git(repo, ["worktree", "remove", "--force", target]).catch(() => {})
    await fs.rm(target, { recursive: true, force: true })
    await git(repo, ["worktree", "prune"]).catch(() => {})
    await git(repo, ["branch", "-D", branch]).catch(() => {})
  }

  dispose(target: DisposeTarget, opts: Parameters<WorkspaceBackend["dispose"]>[1]): Promise<void> {
    return this.plain.dispose(target, opts)
  }
}
