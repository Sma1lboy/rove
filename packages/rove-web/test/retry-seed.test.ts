import { describe, expect, test } from "bun:test"
import { spawnArgs } from "../src/new-session.ts"
import { composerKey, retryCommandFrom, retrySeed, seededBases, seededRepos } from "../src/retry-seed.ts"

const ROW = {
  id: "T1",
  label: "orig",
  kind: "task" as const,
  scratch: undefined,
  noProject: undefined,
  machine: undefined,
}
const BRIEF = {
  prompt: "fix it",
  repo: "/w/app",
  engine: "claude",
  baseRef: "main",
  extraRepos: [{ repo: "/w/api", baseRef: "release" }, { repo: "/w/web" }],
}

describe("retrySeed", () => {
  test("a multi-repo worktree task reopens with every repo and each one's base, the prompt, engine and worktree on", () => {
    const seed = retrySeed(ROW, BRIEF)
    expect(seed).toMatchObject({
      repo: "/w/app",
      baseBranch: "main",
      extras: BRIEF.extraRepos,
      prompt: "fix it",
      engine: "claude",
      worktree: true,
      retryOf: { id: "T1", label: "orig" },
    })
    expect(seededRepos("/w/app", seed)).toEqual(["/w/app", "/w/api", "/w/web"])
    expect(seededBases("/w/app", seed)).toEqual({ "/w/app": "main", "/w/api": "release" })
  })

  test("a project's own checkout retries in place, and an ungrouped one in no project with no extra repos", () => {
    expect(retrySeed({ ...ROW, kind: "main" as never }, BRIEF).worktree).toBe(false)
    const ungrouped = retrySeed({ ...ROW, scratch: true }, BRIEF)
    expect(ungrouped.ungrouped).toBe(true)
    expect(ungrouped.repo).toBeUndefined()
    expect(ungrouped.extras).toBeUndefined()
  })

  test("with no starting project nothing is seeded", () => {
    expect(seededRepos(undefined, retrySeed(ROW, BRIEF))).toEqual([])
    expect(seededBases(undefined, retrySeed(ROW, BRIEF))).toEqual({})
  })
})

describe("the open composer", () => {
  test("takes the base and worktree of a second branch seed for the same repo", () => {
    const plain = { repo: "/w/app" }
    const fromA = { repo: "/w/app", baseBranch: "feat-a", worktree: true }
    const fromB = { repo: "/w/app", baseBranch: "feat-b", worktree: true }
    // A new key remounts the composer, which reads the seed only as it mounts.
    expect(composerKey(fromB)).not.toBe(composerKey(fromA))
    expect(composerKey(fromB)).not.toBe(composerKey(plain))
    expect(composerKey({ ...fromB, worktree: false })).not.toBe(composerKey(fromB))
    expect(seededBases("/w/app", fromB)).toEqual({ "/w/app": "feat-b" })
    // The same seed again (a reload restores it) keeps the composer and what was typed into it.
    expect(composerKey({ ...fromB })).toBe(composerKey(fromB))
  })
})

describe("the retried task's launch command", () => {
  const seed = retrySeed(ROW, BRIEF)

  test("is kept while the engine is still the one that task ran, and dropped once another is picked", () => {
    expect(retryCommandFrom(seed, "claude")).toBe("T1")
    expect(retryCommandFrom(seed, "codex")).toBeUndefined()
    expect(retryCommandFrom({}, "claude")).toBeUndefined()
  })

  test("rides task.spawn as commandFrom, but never on a compare round", () => {
    const base = {
      repos: [{ repo: "/w/app", baseRef: "" }],
      branch: "",
      engine: "claude",
      prompt: "p",
      begin: true,
      model: "",
    }
    expect(spawnArgs({ ...base, commandFrom: "T1" })).toMatchObject({ engine: "claude", commandFrom: "T1" })
    expect(spawnArgs({ ...base, commandFrom: "T1", engines: ["claude", "codex"] })).not.toHaveProperty("commandFrom")
  })
})
