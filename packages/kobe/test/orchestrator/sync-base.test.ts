/**
 * `syncWorktreeWithBase`'s dirty guard, against real git.
 *
 * The guard existed to stop `git merge` clobbering (or refusing over) files the
 * worktree already has, and its comment named untracked files as the hazard —
 * but it ran `git status --untracked-files=no`, which is blind to exactly that.
 * An untracked file the base also adds slipped past it, `git merge` refused,
 * `--diff-filter=U` came back empty, and the user got a bare "git merge failed"
 * that `sync-base-action.ts` cannot map to any named outcome.
 *
 * Real git because the whole question is which states git refuses and what it
 * reports for each; a stubbed runner would only restate the assumption.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { SYNC_CONFLICT, SYNC_DIRTY, syncWorktreeWithBase } from "../../src/orchestrator/sync-base.ts"

let tmpRoot: string
let repo: string

function gitOk(args: string[], cwd = repo): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`)
}

function write(rel: string, body: string): void {
  fs.writeFileSync(path.join(repo, rel), body)
}

async function sync(): Promise<Error | null> {
  return syncWorktreeWithBase(repo, "main", new AbortController().signal).then(
    () => null,
    (e: unknown) => e as Error,
  )
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-sync-base-"))
  repo = path.join(tmpRoot, "repo")
  fs.mkdirSync(repo)
  gitOk(["init", "-b", "main"])
  gitOk(["config", "user.email", "t@t.t"])
  gitOk(["config", "user.name", "t"])
  write("f.txt", "base\n")
  gitOk(["add", "-A"])
  gitOk(["commit", "-m", "base"])
  gitOk(["branch", "feat"])
})

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    // ignored
  }
})

describe("syncWorktreeWithBase dirty guard", () => {
  test("refuses up front when an untracked file collides with one the base adds", async () => {
    write("new.txt", "from-base\n")
    gitOk(["add", "-A"])
    gitOk(["commit", "-m", "base adds new.txt"])
    gitOk(["checkout", "feat"])
    write("new.txt", "mine\n") // untracked here; main has it tracked

    const err = await sync()

    expect(err?.message).toContain(SYNC_DIRTY)
    expect(err?.message).not.toContain("git merge main failed")
    // Names the file: "commit or stash the worktree's changes" is not
    // actionable when the change is one untracked file nobody knew was there.
    expect(err?.message).toContain("new.txt")
    // Refused BEFORE touching anything — the file is still the worktree's own.
    expect(fs.readFileSync(path.join(repo, "new.txt"), "utf8")).toBe("mine\n")
  })

  test("refuses on an uncommitted tracked edit, as it always did", async () => {
    gitOk(["checkout", "feat"])
    write("f.txt", "edited\n")

    const err = await sync()
    expect(err?.message).toContain(SYNC_DIRTY)
    expect(err?.message).toContain("f.txt")
  })

  test("a clean worktree still merges the base in", async () => {
    write("b.txt", "from base\n")
    gitOk(["add", "-A"])
    gitOk(["commit", "-m", "base moves"])
    gitOk(["checkout", "feat"])

    const res = await syncWorktreeWithBase(repo, "main", new AbortController().signal)

    expect(res.alreadyCurrent).toBe(false)
    expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(true)
  })

  test("a real content conflict is still SYNC_CONFLICT with its file list", async () => {
    gitOk(["checkout", "feat"])
    write("f.txt", "theirs\n")
    gitOk(["add", "-A"])
    gitOk(["commit", "-m", "feat edits f"])
    gitOk(["checkout", "main"])
    write("f.txt", "ours\n")
    gitOk(["add", "-A"])
    gitOk(["commit", "-m", "main edits f"])
    gitOk(["checkout", "feat"])

    const err = await sync()

    expect(err?.message).toContain(SYNC_CONFLICT)
    expect(err?.message).toContain("f.txt")
  })

  test("the residual failure branch quotes git instead of saying only that it failed", async () => {
    gitOk(["checkout", "feat"])

    const err = await syncWorktreeWithBase(repo, "no-such-ref", new AbortController().signal).then(
      () => null,
      (e: unknown) => e as Error,
    )

    expect(err?.message).toContain("git merge no-such-ref failed —")
    expect(err?.message).toMatch(/no-such-ref/)
  })
})
