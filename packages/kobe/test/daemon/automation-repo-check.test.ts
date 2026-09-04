import { describe, expect, it } from "vitest"
import { assertRoutineBaseRef, assertRoutineRepo } from "../../../kobe-daemon/src/daemon/automation-repo-check.ts"

// The local paths are proved end to end against a real daemon (`routine-create
// --repo /nonexistent` errors, a real repo still works). What no end-to-end run
// on this machine can reach is the REMOTE branch: an `ssh://` project key names
// a checkout on another host, so there is nothing here to stat or ask git
// about, and a validator that rejected it would break the one input shape
// `requireRepo` goes out of its way to pass through verbatim.
describe("routine repo validation", () => {
  it("passes a remote project key through without probing the filesystem", async () => {
    await expect(assertRoutineRepo("ssh://me@host/srv/repo")).resolves.toBeUndefined()
    await expect(assertRoutineBaseRef("ssh://me@host/srv/repo", "nosuchbase")).resolves.toBeUndefined()
  })

  it("rejects a local path that is not there", async () => {
    await expect(assertRoutineRepo("/nonexistent/r12ae-no-such-repo")).rejects.toThrow(
      "repo does not exist: /nonexistent/r12ae-no-such-repo",
    )
  })
})
