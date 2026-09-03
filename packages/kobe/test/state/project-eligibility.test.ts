/**
 * The project-admission gate. The rejection cases are the four shapes that
 * actually leaked onto the owner's machine (12 sidebar projects behind 2
 * saved repos); the acceptance cases are the paths that must keep working.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { pathRejection, projectRejection, rejectionReason } from "@/state/project-eligibility"
import { isGitRepo } from "@/state/repos"
import { describe, expect, it } from "vitest"

/** The repo this test runs in — a real checkout at a durable path. */
const REPO_ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")

/** Where Rove's own state lives for this run — see test/setup-env.ts. */
function injectedHome(): string {
  return process.env.KOBE_HOME_DIR ?? homedir()
}

describe("pathRejection", () => {
  it("rejects the four shapes that leaked into the real sidebar", () => {
    expect(pathRejection("/private/tmp/rove-fixture-probe/repo")).toBe("temporary")
    expect(pathRejection("/tmp/rove-i18n-repo-62375")).toBe("temporary")
    expect(pathRejection("/Users/x/i/kobe/packages/kobe/.dev-sandbox/named/ex-gif/home/smoke-repo")).toBe(
      "insideSandbox",
    )
    // The home the run was given, not `homedir()`: `roveStateDir()` follows
    // `KOBE_HOME_DIR`, which test/setup-env.ts points at an empty tmpdir.
    expect(pathRejection(join(injectedHome(), ".rove/worktrees/kobe-0aff/manatee/fixture"))).toBe("roveInternal")
  })

  it("rejects a .scratch checkout wherever it sits", () => {
    expect(pathRejection("/Users/x/i/kobe/.scratch/opentui-visual-5401/fixture-repo")).toBe("insideSandbox")
  })

  it("rejects relative and empty paths", () => {
    expect(pathRejection("")).toBe("notAbsolute")
    expect(pathRejection("./relative")).toBe("notAbsolute")
  })

  it("passes remote project keys through untouched", () => {
    // Their eligibility was settled by the remote-add flow; none of the local
    // path rules can speak about an ssh:// key.
    expect(pathRejection("ssh://user@host/srv/repo")).toBeNull()
  })

  it("accepts an ordinary checkout on path shape alone", () => {
    expect(pathRejection(REPO_ROOT)).toBeNull()
    expect(pathRejection("/Users/jacksonc/i/codefox")).toBeNull()
  })

  it("answers without touching the filesystem", () => {
    // The cleanup scan runs over records whose directory is already gone. A
    // vanished fixture must still report WHY it never belonged, rather than
    // reading as a user's repo that merely moved.
    const gone = "/tmp/rove-i18n-repo-62375/deleted/long/ago"
    expect(pathRejection(gone)).toBe("temporary")
  })
})

describe("projectRejection", () => {
  it("adds the git check on top of path shape", () => {
    // A durable-looking path that path shape alone accepts — so the injected
    // check is the only thing that can reject it. No fs needed: neither
    // function touches the disk.
    const durable = join(homedir(), "Documents", "not-a-repo")
    expect(pathRejection(durable)).toBeNull()
    expect(projectRejection(durable, () => false)).toBe("notGitRepo")
    expect(projectRejection(durable, () => true)).toBeNull()
  })

  it("reports the structural reason even when the git check would also fail", () => {
    // Order matters: a deleted /tmp fixture is `temporary`, not `notGitRepo`.
    expect(projectRejection("/tmp/vanished", () => false)).toBe("temporary")
  })

  it("skips the git check for remote keys", () => {
    // `isGitRepo` returns false for an ssh:// key by design — consulting it
    // would reject every remote project.
    expect(projectRejection("ssh://user@host/srv/repo", () => false)).toBeNull()
  })

  it("accepts this repo with the real git check wired in", () => {
    // The end-to-end shape `addSavedRepo` and `ensureIfEligible` both use.
    expect(projectRejection(REPO_ROOT, isGitRepo)).toBeNull()
  })

  it("skips the fs question entirely when no checker is passed", () => {
    // Bulk scans omit it to save one `git` subprocess per row, so a
    // durable-looking path that is NOT a repo comes back eligible.
    expect(projectRejection("/Users/x/not-a-repo-at-all")).toBeNull()
  })
})

describe("rejectionReason", () => {
  it("has a sentence for every rejection", () => {
    // A missing case would surface to the user as `undefined` in a CLI error.
    for (const r of ["notAbsolute", "notGitRepo", "temporary", "roveInternal", "insideSandbox"] as const) {
      expect(rejectionReason(r)).toMatch(/\w/)
    }
  })
})
