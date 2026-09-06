/**
 * What `delete --delete-branch` / `--delete-remote` report, against a REAL
 * repository.
 *
 * Nothing here can be faked usefully: the whole point of the reporter is that
 * it asks git what is left rather than trusting a callback, so a stubbed git
 * would only test the stub. Each case builds a throwaway repo with a bare
 * remote — the same shape a Rove task has — under the OS temp dir.
 */

import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { reportBranchDeletion } from "../../src/cli/api/delete-branch-report.ts"

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
}

/** A repo on `main` with one commit, plus a bare remote it tracks. */
function fixture(): { repo: string; remote: string } {
  const root = mkdtempSync(join(tmpdir(), "rove-branch-report-"))
  roots.push(root)
  const repo = join(root, "repo")
  const remote = join(root, "remote.git")
  execFileSync("git", ["init", "-q", "--bare", remote])
  execFileSync("git", ["init", "-q", "-b", "main", repo])
  git(repo, "config", "user.email", "t@example.com")
  git(repo, "config", "user.name", "Tester")
  git(repo, "commit", "-q", "--allow-empty", "-m", "init")
  git(repo, "remote", "add", "origin", remote)
  git(repo, "push", "-q", "-u", "origin", "main")
  return { repo, remote }
}

/** A branch one commit ahead of main, optionally pushed. */
function branch(repo: string, name: string, opts: { push?: boolean; merge?: boolean } = {}): void {
  git(repo, "checkout", "-q", "-b", name)
  git(repo, "commit", "-q", "--allow-empty", "-m", `work on ${name}`)
  if (opts.push) git(repo, "push", "-q", "-u", "origin", name)
  git(repo, "checkout", "-q", "main")
  if (opts.merge) git(repo, "merge", "-q", "--no-ff", name, "-m", `merge ${name}`)
}

const localExists = (repo: string, name: string): boolean =>
  execFileSync("git", ["branch", "--list", name], { cwd: repo, encoding: "utf8" }).trim().length > 0

const remoteExists = (repo: string, remote: string, name: string): boolean =>
  execFileSync("git", ["ls-remote", "--heads", remote, name], { cwd: repo, encoding: "utf8" }).trim().length > 0

describe("reportBranchDeletion", () => {
  it("reports nothing at all when no branch flag was passed", () => {
    // The plain delete must stay exactly as fast and as quiet as it was: no
    // git reads, no `branch` key in the reply.
    const { repo } = fixture()
    branch(repo, "fix/untouched")
    expect(reportBranchDeletion(repo, "fix/untouched", { deleteBranch: false, force: false, deleteRemote: false })) //
      .toBeUndefined()
    expect(localExists(repo, "fix/untouched")).toBe(true)
  })

  it("deletes a merged branch and says so, leaving the remote alone", () => {
    const { repo, remote } = fixture()
    branch(repo, "fix/merged", { push: true, merge: true })
    const report = reportBranchDeletion(repo, "fix/merged", { deleteBranch: true, force: false, deleteRemote: false })
    expect(report).toEqual({ branch: "fix/merged", deleted: true })
    expect(localExists(repo, "fix/merged")).toBe(false)
    // The separate opt-in was not given, so the remote branch survives — the
    // half that is recoverable by nobody is never taken implicitly.
    expect(remoteExists(repo, remote, "fix/merged")).toBe(true)
  })

  it("keeps an unmerged branch and hands back git's own reason", () => {
    const { repo } = fixture()
    branch(repo, "fix/unmerged")
    const report = reportBranchDeletion(repo, "fix/unmerged", { deleteBranch: true, force: false, deleteRemote: false })
    expect(report?.deleted).toBe(false)
    expect(report?.keptReason).toMatch(/not fully merged/)
    expect(localExists(repo, "fix/unmerged")).toBe(true)
  })

  it("takes the unmerged branch under --force, the same escalation git offers", () => {
    const { repo } = fixture()
    branch(repo, "fix/forced")
    const report = reportBranchDeletion(repo, "fix/forced", { deleteBranch: true, force: true, deleteRemote: false })
    expect(report).toEqual({ branch: "fix/forced", deleted: true })
    expect(localExists(repo, "fix/forced")).toBe(false)
  })

  it("deletes the remote branch when asked, and names which remote", () => {
    const { repo, remote } = fixture()
    branch(repo, "fix/remote", { push: true, merge: true })
    const report = reportBranchDeletion(repo, "fix/remote", { deleteBranch: true, force: false, deleteRemote: true })
    expect(report).toEqual({
      branch: "fix/remote",
      deleted: true,
      remote: { name: "origin", deleted: true },
    })
    expect(remoteExists(repo, remote, "fix/remote")).toBe(false)
  })

  it("treats an already-absent remote branch as the end state that was asked for", () => {
    // git refuses the push with "remote ref does not exist" — which IS gone,
    // so re-probing rather than trusting the exit code keeps a second delete
    // from reporting a failure the caller cannot act on.
    const { repo } = fixture()
    branch(repo, "fix/never-pushed")
    const report = reportBranchDeletion(repo, "fix/never-pushed", {
      deleteBranch: false,
      force: false,
      deleteRemote: true,
    })
    expect(report?.remote).toEqual({ name: "origin", deleted: true })
    // No local delete was asked for, so the local branch stays and the report
    // says so rather than claiming a deletion nobody requested.
    expect(report?.deleted).toBe(false)
    expect(localExists(repo, "fix/never-pushed")).toBe(true)
  })

  it("says nothing about a task that never had a branch", () => {
    const { repo } = fixture()
    expect(reportBranchDeletion(repo, "", { deleteBranch: true, force: false, deleteRemote: true })).toBeUndefined()
  })
})
