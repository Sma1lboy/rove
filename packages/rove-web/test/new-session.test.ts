import { describe, expect, test } from "bun:test"
import {
  REPO_CAP,
  defaultEngineId,
  digitRow,
  effortChoices,
  engineChipLabel,
  modelChipLabel,
  modelChoices,
  offeredEngines,
  repoChipLabel,
  spawnArgs,
  startInCheckout,
  toggleEngine,
  toggleRepo,
} from "../src/new-session.ts"

const engine = {
  id: "alpha",
  models: [{ id: "m-big", label: "Big" }, { id: "m-small" }],
  effortLevels: ["low", "high"],
}

describe("engines a picker offers", () => {
  const list = [
    { id: "claude", name: "Claude", enabled: true, ready: true },
    { id: "codex", name: "Codex", enabled: false, ready: true },
    { id: "pi", name: "Pi", ready: false },
    { id: "bob", name: "Bob" },
  ]

  test("an engine switched off in Settings is not offered; an older bridge's row with no flag still is", () => {
    expect(offeredEngines(list).map((e) => e.id)).toEqual(["claude", "pi", "bob"])
  })

  test("a task's own engine stays pickable even when it is switched off", () => {
    expect(offeredEngines(list, "codex").map((e) => e.id)).toEqual(["claude", "codex", "pi", "bob"])
  })

  test("the preselected engine is never a disabled one: the first ready of what is offered", () => {
    expect(defaultEngineId(offeredEngines(list.slice(1)))).toBe("bob")
    expect(defaultEngineId(offeredEngines([{ id: "pi", enabled: true, ready: false }]))).toBe("pi")
    expect(defaultEngineId([])).toBe("")
  })

  test("the project's last engine is preselected when offered and ready; otherwise the first ready one", () => {
    const offered = offeredEngines(list)
    expect(defaultEngineId(offered, "bob")).toBe("bob")
    expect(defaultEngineId(offered, "codex")).toBe("claude")
    expect(defaultEngineId(offered, "pi")).toBe("claude")
  })
})

describe("New session composer", () => {
  test("the menu offers the engine's default first, then exactly the registry's models and levels", () => {
    expect(modelChoices(engine, "Default")).toEqual([
      { id: "", label: "Default" },
      { id: "m-big", label: "Big" },
      { id: "m-small", label: "m-small" },
    ])
    expect(effortChoices(engine, "Default").map((c) => c.id)).toEqual(["", "low", "high"])
  })

  test("an engine with no model flag or no effort levels offers nothing to pick", () => {
    expect(modelChoices({ id: "x", acceptsModel: false, models: [{ id: "m" }] }, "Default")).toEqual([])
    expect(effortChoices({ id: "x", effortLevels: [] }, "Default")).toEqual([])
    expect(modelChoices(undefined, "Default")).toEqual([])
  })

  test("an engine with unknown models still offers its default", () => {
    expect(modelChoices({ id: "x", models: null }, "Default")).toEqual([{ id: "", label: "Default" }])
  })

  test("the chip reads `<model> <effort>`, and the engine's name when nothing is pinned", () => {
    const models = modelChoices(engine, "Default")
    expect(modelChipLabel(models, "m-big", "high", "Alpha")).toBe("Big high")
    expect(modelChipLabel(models, "m-big", "", "Alpha")).toBe("Big")
    expect(modelChipLabel(models, "", "", "Alpha")).toBe("Alpha")
  })

  test("digits 1-9 pick that row of the open list; 0, letters and rows past the end pick nothing", () => {
    expect(digitRow("1", 3)).toBe(0)
    expect(digitRow("3", 3)).toBe(2)
    expect(digitRow("4", 3)).toBeNull()
    expect(digitRow("0", 3)).toBeNull()
    expect(digitRow("a", 3)).toBeNull()
    expect(digitRow("12", 20)).toBeNull()
  })

  test("the repo chip names the primary and counts the rest", () => {
    expect(repoChipLabel(["/w/app"])).toBe("app")
    expect(repoChipLabel(["/w/app", "/w/lib", "/w/docs"])).toBe("app +2")
    expect(repoChipLabel([])).toBe("")
  })

  test("Start spawns on the primary repo with the prompt, and pins only what was picked", () => {
    const one = {
      repos: [{ repo: "/w/app", baseRef: "" }],
      branch: "",
      engine: "alpha",
      prompt: "fix it",
      begin: true,
      model: "",
      effort: "",
    }
    expect(spawnArgs(one)).toEqual({ repo: "/w/app", prompt: "fix it", engine: "alpha" })
    expect(spawnArgs({ ...one, repos: [{ repo: "/w/app", baseRef: "dev" }], model: "m-big", effort: "high" })).toEqual({
      repo: "/w/app",
      prompt: "fix it",
      engine: "alpha",
      baseBranch: "dev",
      model: "m-big",
      effort: "high",
    })
  })

  test("Create without starting runs no engine, and the typed prompt names the task instead of being lost", () => {
    const draft = {
      repos: [{ repo: "/w/app", baseRef: "" }],
      branch: "",
      engine: "alpha",
      prompt: "check the composer\nend to end",
      begin: false,
      model: "m-big",
      effort: "",
    }
    expect(spawnArgs(draft)).toEqual({
      repo: "/w/app",
      engine: "alpha",
      model: "m-big",
      title: "check the composer end to end",
    })
    expect(spawnArgs({ ...draft, prompt: "" })).toEqual({ repo: "/w/app", engine: "alpha", model: "m-big" })
  })

  test("further picks become extraRepos in pick order, each with its own base; the branch name is shared", () => {
    expect(
      spawnArgs({
        repos: [
          { repo: "/w/web", baseRef: "main" },
          { repo: "/w/api", baseRef: "dev" },
          { repo: "/w/docs", baseRef: "" },
        ],
        branch: "feat/x",
        engine: "",
        prompt: "go",
        begin: true,
        model: "",
        effort: "",
      }),
    ).toEqual({
      repo: "/w/web",
      baseBranch: "main",
      extraRepos: [{ repo: "/w/api", baseRef: "dev" }, { repo: "/w/docs" }],
      branch: "feat/x",
      prompt: "go",
    })
  })

  test("a branch name left over from a dropped second repo is not sent for a single repo", () => {
    expect(
      spawnArgs({
        repos: [{ repo: "/w/web", baseRef: "" }],
        branch: "feat/x",
        engine: "",
        prompt: "go",
        begin: true,
        model: "",
        effort: "",
      }),
    ).toEqual({ repo: "/w/web", prompt: "go" })
  })

  test("picking appends, un-picking removes, the primary's removal promotes the next pick, the cap holds", () => {
    expect(toggleRepo(["/a"], "/b")).toEqual(["/a", "/b"])
    expect(toggleRepo(["/a", "/b", "/c"], "/a")).toEqual(["/b", "/c"])
    expect(toggleRepo(["/a", "/b"], "/b")).toEqual(["/a"])
    const full = Array.from({ length: REPO_CAP }, (_, i) => `/r${i}`)
    expect(toggleRepo(full, "/extra")).toEqual(full)
  })

  test("several engines fan out as one attempt each; no shared branch, model or effort rides along", () => {
    const compare = {
      repos: [
        { repo: "/w/app", baseRef: "dev" },
        { repo: "/w/api", baseRef: "" },
      ],
      branch: "shared",
      engine: "alpha",
      engines: ["alpha", "beta", "gamma"],
      prompt: "fix it",
      begin: true,
      model: "m-big",
      effort: "high",
    }
    expect(spawnArgs(compare)).toEqual({
      repo: "/w/app",
      baseBranch: "dev",
      extraRepos: [{ repo: "/w/api" }],
      prompt: "fix it",
      agents: "alpha:1,beta:1,gamma:1",
    })
    // One engine in the list is a plain start.
    expect(spawnArgs({ ...compare, repos: [{ repo: "/w/app", baseRef: "" }], engines: ["alpha"] })).toEqual({
      repo: "/w/app",
      prompt: "fix it",
      engine: "alpha",
      model: "m-big",
      effort: "high",
    })
  })

  test("the compare list keeps pick order, never empties, and the chip names the first two", () => {
    expect(toggleEngine(["a"], "b")).toEqual(["a", "b"])
    expect(toggleEngine(["a", "b"], "a")).toEqual(["b"])
    expect(toggleEngine(["a"], "a")).toEqual(["a"])
    expect(engineChipLabel(["Claude"])).toBe("Claude")
    expect(engineChipLabel(["Claude", "Codex"])).toBe("Claude + Codex")
    expect(engineChipLabel(["Claude", "Codex", "Pi", "Omp"])).toBe("Claude + Codex +2")
  })
})

describe("Start with Worktree off", () => {
  /** A bridge whose project already runs a conversation in its main task: the old path nested the new session there. */
  function bridge() {
    const calls: Array<[string, Record<string, unknown> | undefined]> = []
    const request = async <T>(op: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push([op, args])
      if (op === "task.openCheckout") return { taskId: "S1" } as T
      if (op === "task.openMain") return { taskId: "MAIN" } as T
      return {} as T
    }
    return { calls, request }
  }

  test("the session is a row of its own, titled from the prompt, and the engine starts in that row, never in the main task", async () => {
    const { calls, request } = bridge()

    const id = await startInCheckout(
      request,
      "/w/rove",
      "codex",
      "fix the flaky login test",
      true,
      "fix the flaky login test @a.png",
    )

    expect(id).toBe("S1")
    expect(calls).toEqual([
      ["task.openCheckout", { repo: "/w/rove", engine: "codex", title: "fix the flaky login test" }],
      ["tab.new", { taskId: "S1", kind: "engine", engine: "codex", prompt: "fix the flaky login test @a.png" }],
    ])
  })

  test("an unstarted session takes its title from the prompt and starts no engine; no prompt leaves the daemon's title", async () => {
    const withPrompt = bridge()
    await startInCheckout(withPrompt.request, "/w/rove", "", "plan the release", false)
    expect(withPrompt.calls).toEqual([["task.openCheckout", { repo: "/w/rove", title: "plan the release" }]])

    const bare = bridge()
    await startInCheckout(bare.request, "/w/rove", "", "  ", false)
    expect(bare.calls).toEqual([["task.openCheckout", { repo: "/w/rove" }]])
  })
})
