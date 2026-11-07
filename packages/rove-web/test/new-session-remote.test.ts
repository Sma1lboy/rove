import { describe, expect, test } from "bun:test"
import {
  type RemoteRepo,
  githubRepoHeld,
  remoteRef,
  remoteSpawnArgs,
  seedRemotePick,
} from "../src/new-session-remote.ts"

const rove: RemoteRepo = {
  id: "github.com/sma1lboy/rove",
  primary: "/home/me/rove",
  checkouts: ["/tmp/rove", "/home/me/rove"],
}
const scratch: RemoteRepo = { id: "root:abc123", primary: null, checkouts: ["/home/me/scratch"] }

describe("New session composer on another machine", () => {
  test("a repo with an origin goes by id; one without goes by the machine's own checkout path", () => {
    expect(remoteRef(rove)).toBe("github.com/sma1lboy/rove")
    expect(remoteRef(scratch)).toBe("/home/me/scratch")
    expect(remoteRef({ ...scratch, primary: "/home/me/main-scratch" })).toBe("/home/me/main-scratch")
  })

  test("a rail row's checkout path is picked as the listed repo; an unlisted absolute path stays a path", () => {
    expect(seedRemotePick("/tmp/rove", [rove, scratch])).toEqual({ ref: "github.com/sma1lboy/rove", clone: false })
    expect(seedRemotePick("/home/me/scratch", [rove, scratch])).toEqual({ ref: "/home/me/scratch", clone: false })
    expect(seedRemotePick("/srv/other", [rove])).toEqual({ ref: "/srv/other", clone: false })
    expect(seedRemotePick("rove", [rove])).toBeNull()
    expect(seedRemotePick(undefined, [rove])).toBeNull()
  })

  test("a GitHub repo already on that machine is not offered for cloning there, whatever its folder is called", () => {
    const held = [remoteRef(rove), remoteRef(scratch)]
    expect(githubRepoHeld(held, "Sma1lboy/Rove", true)).toBe(true)
    expect(githubRepoHeld(held, "someone/rove", true)).toBe(false)
    expect(githubRepoHeld(held, "sma1lboy/scratch", true)).toBe(false)
  })

  test("on this machine a GitHub repo whose name matches a saved project's folder is taken to be that clone", () => {
    expect(githubRepoHeld(["/Users/me/code/rove"], "sma1lboy/Rove", false)).toBe(true)
    expect(githubRepoHeld(["/Users/me/code/rove"], "sma1lboy/other", false)).toBe(false)
  })

  test("Start sends the repo, the machine and clone only for a repo it has to fetch, and never a model or effort", () => {
    const base = { machine: "wsl", engine: "claude", prompt: "fix it", begin: true, baseRef: "" }
    expect(remoteSpawnArgs({ ...base, pick: { ref: "github.com/sma1lboy/rove", clone: false } })).toEqual({
      repo: "github.com/sma1lboy/rove",
      machine: "wsl",
      prompt: "fix it",
      engine: "claude",
    })
    expect(
      remoteSpawnArgs({ ...base, pick: { ref: "sma1lboy/rove", clone: true }, baseRef: "dev", engine: "" }),
    ).toEqual({ repo: "sma1lboy/rove", machine: "wsl", clone: true, baseBranch: "dev", prompt: "fix it" })
  })

  test("Create without starting names the task by the typed prompt instead of losing it", () => {
    const args = remoteSpawnArgs({
      pick: { ref: "/srv/app", clone: false },
      machine: "wsl",
      engine: "",
      prompt: "add a retry to the uploader",
      begin: false,
      baseRef: "",
    })
    expect(args.prompt).toBeUndefined()
    expect(args.title).toBe("add a retry to the uploader")
  })
})
