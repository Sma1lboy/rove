import { describe, expect, test } from "bun:test"
import {
  REPO_CAP,
  digitRow,
  effortChoices,
  modelChipLabel,
  modelChoices,
  repoChipLabel,
  spawnArgs,
  toggleRepo,
} from "../src/new-session.ts"

const engine = {
  id: "alpha",
  models: [{ id: "m-big", label: "Big" }, { id: "m-small" }],
  effortLevels: ["low", "high"],
}

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

  test("Create without starting sends no prompt, so no engine runs", () => {
    expect(
      spawnArgs({
        repos: [{ repo: "/w/app", baseRef: "" }],
        branch: "",
        engine: "alpha",
        prompt: "",
        model: "m-big",
        effort: "",
      }),
    ).toEqual({ repo: "/w/app", engine: "alpha", model: "m-big" })
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
})
