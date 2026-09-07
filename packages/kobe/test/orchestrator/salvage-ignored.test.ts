/**
 * A salvage snapshot must not throw away gitignored WORK.
 *
 * `git add -A` honours `.gitignore`, which was documented as a `node_modules/`
 * exclusion — but `.gitignore` says "don't track this", not "this isn't the
 * user's work". In the Rove repo itself, `HANDOFF.md`, `.scratch/**`, `.env*`
 * and `.rove/*` are all ignored, and the first two are exactly where AGENTS.md
 * tells agents to keep cross-session reasoning. Force-deleting a worktree
 * destroyed all of them while reporting a successful salvage.
 *
 * The rule that replaces the exclusion is a size budget, so the assertions
 * check BOTH directions on one worktree: the small ignored files come back out
 * of the object database, and the big ignored tree is still left out (a
 * snapshot that swallows `node_modules/` is one nobody can use).
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test } from "vitest"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import { parseDuKb, parseIgnoredPaths } from "../../src/orchestrator/worktree/salvage-ignored.ts"

let tmpRoot: string
let repo: string

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
  return r.stdout
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rove-salvage-ig-"))
  repo = path.join(tmpRoot, "repo")
  fs.mkdirSync(repo)
  git(repo, "init", "-q", ".")
  git(repo, "config", "user.email", "test@example.com")
  git(repo, "config", "user.name", "Test")
  fs.writeFileSync(path.join(repo, "tracked.txt"), "committed\n")
  // The Rove repo's own ignore set, near enough: build output plus the files
  // that actually carry an agent's unpushed reasoning.
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\nHANDOFF.md\n.scratch/\n.env\n*.log\n")
  git(repo, "add", "-A")
  git(repo, "commit", "-qm", "init")
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test("force-removal salvages gitignored work but leaves a bulk ignored tree out", async () => {
  const wt = path.join(tmpRoot, "feature")
  git(repo, "worktree", "add", "-q", wt, "-b", "feature")

  // Ordinary dirty state, already covered by the existing salvage test.
  fs.appendFileSync(path.join(wt, "tracked.txt"), "uncommitted edit\n")
  fs.writeFileSync(path.join(wt, "never-added.txt"), "brand new file\n")

  // Gitignored, and unambiguously the user's work.
  fs.writeFileSync(path.join(wt, "HANDOFF.md"), "the handoff nobody committed\n")
  fs.mkdirSync(path.join(wt, ".scratch", "feat"), { recursive: true })
  fs.writeFileSync(path.join(wt, ".scratch", "feat", "plan.md"), "the plan\n")
  fs.writeFileSync(path.join(wt, ".env"), "TOKEN=secret\n")

  // Gitignored bulk: one entry over the 64 MB per-entry budget. Real bytes,
  // not a sparse file — `du` reports a sparse file's ALLOCATED size, which is
  // 0 KB, so a sparse "large" file would sail under the budget and prove
  // nothing. 70 MB of zeros writes in milliseconds.
  fs.mkdirSync(path.join(wt, "node_modules", "pkg"), { recursive: true })
  fs.writeFileSync(path.join(wt, "node_modules", "pkg", "bundle.js"), Buffer.alloc(70 * 1024 * 1024))

  let salvaged: { ref: string; commit: string } | null = null
  await new GitWorktreeManager().remove(wt, {
    force: true,
    onSalvage: (record) => {
      salvaged = record
    },
  })

  expect(fs.existsSync(wt)).toBe(false) // the destruction really happened
  const ref = (salvaged as unknown as { ref: string } | null)?.ref
  expect(ref).toBeTruthy()

  // Read the content back OUT of the object database, after the directory is
  // gone: a snapshot nobody can restore from is the failure this prevents.
  const show = (p: string) => git(repo, "show", `${ref}:${p}`)
  expect(show("HANDOFF.md")).toBe("the handoff nobody committed\n")
  expect(show(".scratch/feat/plan.md")).toBe("the plan\n")
  expect(show(".env")).toBe("TOKEN=secret\n")
  expect(show("never-added.txt")).toBe("brand new file\n")
  expect(show("tracked.txt")).toContain("uncommitted edit")

  // The budget still holds the line: the oversized tree is not in the snapshot.
  const files = git(repo, "ls-tree", "-r", "--name-only", ref as string).split("\n")
  expect(files).not.toContain("node_modules/pkg/bundle.js")
  expect(files.some((f) => f.startsWith("node_modules/"))).toBe(false)
})

test("parseIgnoredPaths reads only the ignored entries of a NUL-separated status", () => {
  // Real `git status --porcelain -z --ignored` shape: NUL-separated, ignored
  // directories collapsed to one entry, and a path containing a space (which
  // is why the parse is NUL-based rather than line-and-split).
  const raw = " M tracked.txt\0?? new.txt\0!! .env\0!! .scratch/\0!! sp ace/\0!! node_modules/\0"
  expect(parseIgnoredPaths(raw)).toEqual([".env", ".scratch/", "sp ace/", "node_modules/"])
})

test("parseDuKb keeps paths that contain spaces intact", () => {
  const sizes = parseDuKb("4\tHANDOFF.md\n1403144\tnode_modules/\n8\tsp ace/\n")
  expect(sizes.get("HANDOFF.md")).toBe(4)
  expect(sizes.get("node_modules/")).toBe(1403144)
  expect(sizes.get("sp ace/")).toBe(8)
})

/**
 * The case the size budget was written for, and the one the gate above it
 * could not see: a worktree whose ONLY work is gitignored.
 *
 * `git status --porcelain` — the command both the delete gate and salvage's
 * own early-return read — reports nothing here, so the removal took the clean
 * path: no force, no confirm, and salvage returned before the `add -f` pass
 * ever ran. The files were gone with no ref anywhere.
 */
test("an ignored-only worktree is refused without force, and force salvages the work", async () => {
  const wt = path.join(tmpRoot, "ignored-only")
  git(repo, "worktree", "add", "-q", wt, "-b", "ignored-only")

  fs.writeFileSync(path.join(wt, "HANDOFF.md"), "a whole session of reasoning\n")
  fs.mkdirSync(path.join(wt, ".scratch"), { recursive: true })
  fs.writeFileSync(path.join(wt, ".scratch", "notes.md"), "design notes\n")

  // The premise: to `git status` this worktree is spotlessly clean.
  expect(git(wt, "status", "--porcelain")).toBe("")

  const manager = new GitWorktreeManager()
  await expect(manager.remove(wt)).rejects.toThrow(/gitignored work/)
  // Refusing is only worth anything if the files are still there afterwards.
  expect(fs.existsSync(path.join(wt, "HANDOFF.md"))).toBe(true)
  expect(fs.existsSync(path.join(wt, ".scratch", "notes.md"))).toBe(true)

  let salvaged: { ref: string } | null = null
  await manager.remove(wt, {
    force: true,
    onSalvage: (record) => {
      salvaged = record
    },
  })

  expect(fs.existsSync(wt)).toBe(false)
  const ref = (salvaged as unknown as { ref: string } | null)?.ref
  expect(ref).toBeTruthy()
  expect(git(repo, "show", `${ref}:HANDOFF.md`)).toBe("a whole session of reasoning\n")
  expect(git(repo, "show", `${ref}:.scratch/notes.md`)).toBe("design notes\n")
})

/**
 * The other side of the budget. The gate must refuse for exactly what the
 * force retry would rescue — otherwise a worktree holding nothing but a
 * dependency tree becomes undeletable without `--force`, which is ceremony
 * around no work at all.
 */
test("an ignored tree over the size budget still deletes with no force", async () => {
  const wt = path.join(tmpRoot, "bulk-only")
  git(repo, "worktree", "add", "-q", wt, "-b", "bulk-only")
  fs.mkdirSync(path.join(wt, "node_modules", "pkg"), { recursive: true })
  fs.writeFileSync(path.join(wt, "node_modules", "pkg", "bundle.js"), Buffer.alloc(70 * 1024 * 1024))

  expect(git(wt, "status", "--porcelain")).toBe("")
  await new GitWorktreeManager().remove(wt)
  expect(fs.existsSync(wt)).toBe(false)
})

/**
 * One ignored file whose name starts with `-`, and the protection for every
 * OTHER file in the worktree switches off.
 *
 * `du -sk <paths…>` carried no `--`, so both BSD and GNU `du` read that name
 * as an option bundle (`du: invalid option -- w`, exit 64, empty stdout). The
 * empty size map then failed the `sizes.get(p) !== undefined` filter for every
 * entry, `ignoredWork()` came back empty for the WHOLE worktree, and the
 * non-force delete gate — the only thing standing between `HANDOFF.md` and
 * `git worktree remove` — stopped refusing. The non-force path takes no
 * salvage snapshot, so the file was gone with no copy anywhere.
 *
 * Both halves are asserted on one worktree: what the probe reports, and what
 * is still on disk after the removal it authorizes.
 */
test("an ignored file named like a flag does not disarm the ignored-work gate", async () => {
  const wt = path.join(tmpRoot, "dash-named")
  git(repo, "worktree", "add", "-q", wt, "-b", "dash-named")
  fs.writeFileSync(path.join(wt, "HANDOFF.md"), "a whole session of reasoning\n")
  fs.writeFileSync(path.join(wt, "-weird.log"), "innocuous\n")

  // `.gitignore` covers both, and to `git status --porcelain` this is clean.
  expect(git(wt, "status", "--porcelain")).toBe("")

  const ignored = await new GitWorktreeManager().ignoredWork(wt)
  expect(ignored).toContain("HANDOFF.md")
  expect(ignored).toContain("-weird.log")

  await expect(new GitWorktreeManager().remove(wt)).rejects.toThrow(/gitignored work/)
  expect(fs.existsSync(path.join(wt, "HANDOFF.md"))).toBe(true)
})
