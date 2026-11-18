import { describe, expect, test } from "bun:test"
import {
  type RemoteRepo,
  carriedPick,
  cloneLabel,
  enginesThere,
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

  test("a machine switch keeps the project: its checkout there, a clone when that machine lacks it, nothing without an origin", () => {
    const here: RemoteRepo[] = [
      { id: "github.com/me/dotfiles", primary: null, checkouts: ["/Users/me/dotfiles"] },
      { id: "root:abc123", primary: null, checkouts: ["/Users/me/scratch"] },
    ]
    const there: RemoteRepo[] = [{ id: "github.com/me/dotfiles", primary: null, checkouts: ["/home/me/.dotfiles"] }]
    expect(carriedPick("/Users/me/dotfiles", here, there)).toEqual({ ref: "github.com/me/dotfiles", clone: false })
    expect(carriedPick("/Users/me/dotfiles", here, [])).toEqual({ ref: "github.com/me/dotfiles", clone: true })
    expect(carriedPick("/Users/me/scratch", here, there)).toBeNull()
    expect(carriedPick("/Users/me/unlisted", here, there)).toBeNull()
  })

  test("the engine chip lists that machine's engines: the ones it lacks marked, the ones only it has added", () => {
    const here = [
      { id: "claude", name: "Claude" },
      { id: "codex", name: "Codex" },
    ]
    const out = enginesThere(here, [
      { id: "claude", installed: true },
      { id: "codex", installed: false },
      { id: "pi", name: "Pi" },
    ])
    expect(out.rows.map((e) => e.name)).toEqual(["Claude", "Codex", "Pi"])
    expect([...out.missing]).toEqual(["codex"])
    // A machine that cannot say gates nothing.
    expect(enginesThere(here, [])).toEqual({ rows: here, missing: new Set() })
  })

  test.each(["github.com/acme/app", "acme/app", "https://github.com/acme/app.git", "git@github.com:acme/app.git"])(
    "a clone pick is named owner/repo, whatever form its source takes: %s",
    (ref) => {
      expect(cloneLabel(ref)).toBe("acme/app")
    },
  )

  test("by default the agent is this machine's, so its model rides along; with the engine there it does not", () => {
    const input = {
      pick: { ref: "github.com/me/dotfiles", clone: false },
      machine: "deck",
      engine: "claude",
      prompt: "fix it",
      baseRef: "",
      model: "opus",
    }
    expect(remoteSpawnArgs({ ...input, engineThere: false })).toEqual({
      repo: "github.com/me/dotfiles",
      machine: "deck",
      prompt: "fix it",
      engine: "claude",
      model: "opus",
    })
    expect(remoteSpawnArgs({ ...input, engineThere: true })).toEqual({
      repo: "github.com/me/dotfiles",
      machine: "deck",
      prompt: "fix it",
      engine: "claude",
      engineThere: true,
    })
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

  test("Start sends the repo, the machine and clone only for a repo it has to fetch", () => {
    const base = {
      machine: "wsl",
      engine: "claude",
      prompt: "fix it",
      baseRef: "",
      engineThere: false,
      model: "",
    }
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
})
