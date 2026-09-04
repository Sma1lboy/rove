import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runGitStatus } from "@sma1lboy/kobe-daemon/daemon/worktree-changes-collector"
import { expect, it } from "vitest"

it("the extracted runner reads real status and drift, and degrades when the base ref is missing", async () => {
  const repo = mkdtempSync(join(tmpdir(), "rove-status-runner-"))
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  git("init")
  writeFileSync(join(repo, "first.txt"), "first\n")
  git("add", "first.txt")
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "Initial fixture")
  const base = git("rev-parse", "HEAD")
  writeFileSync(join(repo, "second.txt"), "second\n")
  git("add", "second.txt")
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "Advance fixture")
  writeFileSync(join(repo, "untracked.txt"), "untracked\n")
  const signal = new AbortController().signal
  await expect(runGitStatus(repo, signal, base)).resolves.toEqual({ added: 1, deleted: 0, behind: 0, ahead: 1 })
  await expect(runGitStatus(repo, signal)).resolves.toEqual({ added: 1, deleted: 0 })
  await expect(runGitStatus(repo, signal, "missing-reference")).resolves.toEqual({ added: 1, deleted: 0 })
  await expect(runGitStatus(join(repo, "missing"), signal)).rejects.toThrow("git status failed")
  const aborted = new AbortController()
  aborted.abort()
  await expect(runGitStatus(repo, aborted.signal)).rejects.toThrow("git status failed")
})
