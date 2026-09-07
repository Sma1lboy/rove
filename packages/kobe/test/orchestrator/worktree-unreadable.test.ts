/**
 * `git worktree list --porcelain` omits a worktree whose admin dir it cannot
 * read — with no stderr and a ZERO exit. Passing that through made
 * `discover-adoptable` answer `{"worktrees":[]}` for a repo that has a
 * worktree with uncommitted work in it: a result indistinguishable from
 * "nothing to adopt", and no path for the user to reach the work.
 *
 * These pin the cross-check with a STUBBED porcelain reader over a real
 * admin-dir layout. The unreadable admin dir is modelled by a missing `gitdir`
 * file rather than `chmod 000`: the production trigger is EACCES, the code
 * branches on any read failure, and chmod is a coin flip under a root CI user.
 * The real EACCES path is covered end-to-end by the CLI reproduction in the
 * PR — this suite covers the decision logic.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, expect, it } from "vitest"
import type { ExecCtx } from "../../src/orchestrator/worktree/exec-deps.ts"
import { type ListDeps, unreadableWorktreeNames } from "../../src/orchestrator/worktree/manager-list.ts"

let root: string
let repo: string
let adminRoot: string

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "kobe-wt-unreadable-")))
  repo = join(root, "repo")
  adminRoot = join(repo, ".git", "worktrees")
  mkdirSync(adminRoot, { recursive: true })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** One admin dir. `gitdir` absent = the entry git could not read. */
function admin(name: string, worktreePath?: string): void {
  mkdirSync(join(adminRoot, name), { recursive: true })
  if (worktreePath) writeFileSync(join(adminRoot, name, "gitdir"), `${join(worktreePath, ".git")}\n`, "utf8")
}

function porcelain(...paths: string[]): string {
  return paths.map((p) => `worktree ${p}\nHEAD abc123\nbranch refs/heads/b\n`).join("\n")
}

function deps(listed: string): ListDeps {
  return {
    ctxFor: () => ({ dir: repo, remote: false }) as unknown as ExecCtx,
    async runGitStdout(_ctx, args) {
      if (args[0] === "rev-parse") return ".git\n"
      if (args[0] === "worktree") return listed
      throw new Error(`unexpected git ${args.join(" ")}`)
    },
    runGitStdoutAt: async () => "",
    isDirty: async () => false,
  }
}

const ctx = () => ({ dir: repo, remote: false }) as unknown as ExecCtx

it("reports an admin dir git omitted from its own porcelain list", async () => {
  admin("healthy", join(root, "healthy"))
  admin("broken") // no gitdir — unreadable, exactly what git skips
  const names = await unreadableWorktreeNames(deps(porcelain(repo, join(root, "healthy"))), ctx())
  expect(names).toEqual(["broken"])
})

it("reports nothing when every admin dir is accounted for", async () => {
  rmSync(join(adminRoot, "broken"), { recursive: true, force: true })
  const names = await unreadableWorktreeNames(deps(porcelain(repo, join(root, "healthy"))), ctx())
  expect(names).toEqual([])
})

/**
 * Git de-duplicates colliding basenames (`foo`, `foo1`), so comparing admin
 * NAMES against porcelain paths would flag a perfectly healthy second `foo` as
 * missing. The match runs on the path each `gitdir` resolves to.
 */
it("does not flag a de-duplicated admin name whose worktree IS listed", async () => {
  const other = join(root, "other", "healthy")
  admin("healthy1", other)
  const names = await unreadableWorktreeNames(deps(porcelain(repo, join(root, "healthy"), other)), ctx())
  expect(names).toEqual([])
  rmSync(join(adminRoot, "healthy1"), { recursive: true, force: true })
})

it("stays out of the way when it cannot enumerate at all", async () => {
  // A repo with no `.git/worktrees` at all, and a remote ctx (whose admin dirs
  // are not on this filesystem) must both answer `[]` — this check augments
  // discovery, it must never dark it.
  const bare = join(root, "bare")
  mkdirSync(bare, { recursive: true })
  const bareCtx = { dir: bare, remote: false } as unknown as ExecCtx
  await expect(unreadableWorktreeNames(deps(porcelain(bare)), bareCtx)).resolves.toEqual([])
  const remoteCtx = { dir: repo, remote: true } as unknown as ExecCtx
  await expect(unreadableWorktreeNames(deps(porcelain(repo)), remoteCtx)).resolves.toEqual([])
})
