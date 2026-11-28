import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { welcomeDeps, welcomeOps } from "../src/ops/welcome.ts"
import { fakeApi } from "./task-ops-harness.ts"

const real = { ...welcomeDeps }
beforeEach(() => {
  welcomeDeps.cwd = () => "/work/app"
  welcomeDeps.gitOnPath = () => true
  welcomeDeps.engines = async () => ({ usable: ["codex", "claude"], signedOut: [] })
  welcomeDeps.repoOf = (dir) => (dir === "/work/app" ? "/work/app" : null)
  welcomeDeps.branchOf = () => "feat/x"
  welcomeDeps.preferredEngine = () => "claude"
  welcomeDeps.savedRepos = () => []
})
afterEach(() => Object.assign(welcomeDeps, real))

const probe = () => welcomeOps["welcome.env"]?.run({}, { api: fakeApi().api }) as Promise<Record<string, unknown>>

describe("welcome.env", () => {
  test("offers a quick start on the cwd's repo with its branch and the preferred ready engine", async () => {
    expect(await probe()).toEqual({
      engines: [
        { id: "codex", name: "Codex" },
        { id: "claude", name: "Claude" },
      ],
      signedOut: [],
      git: true,
      start: { repo: "/work/app", label: "app", baseRef: "feat/x", engine: "claude" },
      project: "/work/app",
    })
  })

  test("no quick start outside a repo, from a deleted directory, without git, or without a usable engine", async () => {
    welcomeDeps.repoOf = () => null
    expect((await probe()).start).toBeNull()
    welcomeDeps.repoOf = () => "/work/app"
    welcomeDeps.cwd = () => null
    expect(await probe()).toMatchObject({ git: true, start: null })
    welcomeDeps.gitOnPath = () => false
    expect(await probe()).toMatchObject({ git: false, start: null })
    welcomeDeps.gitOnPath = () => true
    welcomeDeps.engines = async () => ({ usable: [], signedOut: ["claude"] })
    expect(await probe()).toMatchObject({ engines: [], signedOut: [{ id: "claude" }], start: null })
  })

  test("an engine whose login Rove cannot read is marked, so the welcome does not call it signed in", async () => {
    welcomeDeps.engines = async () => ({ usable: ["pi", "claude"], signedOut: [], loginUnknown: ["pi"] })
    expect((await probe()).engines).toEqual([
      { id: "pi", name: "Pi", login: "unknown" },
      { id: "claude", name: "Claude" },
    ])
  })

  test("a preferred engine that is not ready yields to the first ready one", async () => {
    welcomeDeps.preferredEngine = () => "kimi"
    expect(await probe()).toMatchObject({ start: { engine: "codex" } })
  })

  test("the project is the cwd's repo, else a saved one, else none", async () => {
    welcomeDeps.repoOf = () => null
    expect((await probe()).project).toBeNull()
    welcomeDeps.savedRepos = () => ["/work/saved"]
    expect((await probe()).project).toBe("/work/saved")
  })

  test("a signed-out engine carries the shell line that runs its CLI, quoted when the path needs it", async () => {
    welcomeDeps.engines = async () => ({
      usable: [],
      signedOut: ["claude", "codex"],
      programs: { claude: "/Users/a b/bin/claude" },
    })
    expect((await probe()).signedOut).toEqual([
      { id: "claude", name: "Claude", signIn: "'/Users/a b/bin/claude'" },
      { id: "codex", name: "Codex", signIn: "codex" },
    ])
  })
})
