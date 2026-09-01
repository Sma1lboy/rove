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
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\nHANDOFF.md\n.scratch/\n.env\n")
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
