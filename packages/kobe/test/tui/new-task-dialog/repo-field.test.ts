/**
 * Unit tests for the repo field's name↔path vocabulary
 * (`src/tui/component/new-task-dialog/repo-field.ts`).
 *
 * These are the boundary the whole "show a name" change rests on: the field
 * holds a NAME and everything downstream needs a PATH, so every conversion
 * between the two happens in these three functions. The render tests drive the
 * mounted dialog; these pin the rules that make it safe — above all that a
 * name shared by two saved repos is REFUSED rather than resolved to whichever
 * one sorts first.
 */

import {
  nameOrPath,
  resolveRepoInput,
  siblingRepoCandidates,
  splitRepoInput,
} from "@/tui/component/new-task-dialog/repo-field"
import { describe, expect, it, vi } from "vitest"

describe("splitRepoInput", () => {
  it("splits a resolved path into the name and the directory that locates it", () => {
    expect(splitRepoInput("/Users/me/i/quokka", true)).toEqual({ name: "quokka", dir: "/Users/me/i/" })
  })

  it("leaves an UNRESOLVED value verbatim — a half-typed path is not a name", () => {
    // Splitting mid-typing would leave the field disagreeing with the keys
    // that produced it.
    expect(splitRepoInput("/Users/me/i/quo", false)).toEqual({ name: "/Users/me/i/quo", dir: "" })
  })

  it("has nothing to split when the value has no directory part", () => {
    expect(splitRepoInput("quokka", true)).toEqual({ name: "quokka", dir: "" })
  })
})

describe("resolveRepoInput", () => {
  const repos = ["/Users/me/i/quokka", "/Users/me/i/wisp"]

  it("resolves a known name to its one path", () => {
    expect(resolveRepoInput("quokka", repos)).toEqual({ kind: "path", path: "/Users/me/i/quokka" })
  })

  it("REFUSES a name two saved repos share, rather than picking one", () => {
    // The whole reason the ambiguous case exists: with ~100 repos flat under
    // one parent, duplicate basenames are ordinary, and resolving to the first
    // match would silently open the wrong repo.
    const dupes = ["/Users/me/a/app", "/Users/me/b/app"]
    expect(resolveRepoInput("app", dupes)).toEqual({ kind: "ambiguous", name: "app", matches: dupes })
  })

  it("passes a path straight through — it is already the answer", () => {
    expect(resolveRepoInput("/tmp/elsewhere", repos)).toEqual({ kind: "path", path: "/tmp/elsewhere" })
    expect(resolveRepoInput("~/i/quokka", repos)).toEqual({ kind: "path", path: "~/i/quokka" })
  })

  it("leaves an unknown name alone so validateRepoPath owns the error", () => {
    // Not this layer's job to invent a second vocabulary for "no such repo".
    expect(resolveRepoInput("nosuchrepo", repos)).toEqual({ kind: "path", path: "nosuchrepo" })
  })

  it("treats an empty value as an empty path, not as a name matching nothing", () => {
    expect(resolveRepoInput("   ", repos)).toEqual({ kind: "path", path: "" })
  })

  describe("a name the saved list does not hold, with a probe", () => {
    // Saved repos cluster under a few parents; a repo the list has never
    // seen almost always lives beside one of them. The probe is injected so
    // this module stays fs-free — here it is a set of paths that "exist".
    const spread = ["/Users/me/i/quokka", "/Users/me/i/wisp", "/Users/me/work/api"]
    const probeFor = (existing: readonly string[]) => (p: string) => existing.includes(p)

    it("resolves to the same-named git dir under a saved repo's parent", () => {
      const probe = probeFor(["/Users/me/work/rove"])
      expect(resolveRepoInput("rove", spread, probe)).toEqual({ kind: "path", path: "/Users/me/work/rove" })
    })

    it("REFUSES a name found under two parents, rather than picking one", () => {
      const probe = probeFor(["/Users/me/i/rove", "/Users/me/work/rove"])
      expect(resolveRepoInput("rove", spread, probe)).toEqual({
        kind: "ambiguous",
        name: "rove",
        matches: ["/Users/me/i/rove", "/Users/me/work/rove"],
      })
    })

    it("still leaves the raw name alone when no parent holds it", () => {
      expect(resolveRepoInput("rove", spread, probeFor([]))).toEqual({ kind: "path", path: "rove" })
    })

    it("never probes when a saved repo already answers", () => {
      const probe = vi.fn(() => true)
      expect(resolveRepoInput("quokka", spread, probe)).toEqual({ kind: "path", path: "/Users/me/i/quokka" })
      expect(probe).not.toHaveBeenCalled()
    })

    it("never probes for a path-shaped value", () => {
      const probe = vi.fn(() => true)
      resolveRepoInput("~/anything", spread, probe)
      resolveRepoInput("/tmp/x", spread, probe)
      expect(probe).not.toHaveBeenCalled()
    })
  })
})

describe("siblingRepoCandidates", () => {
  it("puts the name under each DISTINCT saved parent, in list order", () => {
    const repos = ["/Users/me/i/quokka", "/Users/me/i/wisp", "/Users/me/work/api"]
    expect(siblingRepoCandidates("rove", repos)).toEqual(["/Users/me/i/rove", "/Users/me/work/rove"])
  })

  it("skips saved entries that carry no directory part", () => {
    // A bare name or a trailing slash locates nothing, so it cannot have
    // siblings; a stray whitespace entry should not produce ` rove` either.
    expect(siblingRepoCandidates("rove", ["quokka", "/Users/me/i/", " /Users/me/i/wisp "])).toEqual([
      "/Users/me/i/rove",
    ])
  })
})

describe("nameOrPath (what the field should hold)", () => {
  const repos = ["/Users/me/i/quokka", "/Users/me/i/wisp"]

  it("uses the name when the name round-trips back to that path", () => {
    expect(nameOrPath("/Users/me/i/quokka", repos)).toBe("quokka")
  })

  it("keeps the PATH when the name is ambiguous — it identifies nothing", () => {
    const dupes = ["/Users/me/a/app", "/Users/me/b/app"]
    expect(nameOrPath("/Users/me/a/app", dupes)).toBe("/Users/me/a/app")
    expect(nameOrPath("/Users/me/b/app", dupes)).toBe("/Users/me/b/app")
  })

  it("keeps the PATH for a repo outside the saved list", () => {
    // Its basename resolves to itself, not back to the path, so the name would
    // name nothing the dialog can find.
    expect(nameOrPath("/tmp/scratch", repos)).toBe("/tmp/scratch")
  })

  it("uses the name for a browsed-to sibling the probe can find again", () => {
    // Picked from the directory browser, never saved — but it sits beside the
    // saved repos, so its name round-trips and the field can show it short.
    const probe = (p: string) => p === "/Users/me/i/rove"
    expect(nameOrPath("/Users/me/i/rove", repos, probe)).toBe("rove")
  })

  it("keeps the PATH for a sibling whose name is also found elsewhere", () => {
    const probe = (p: string) => p === "/Users/me/i/rove" || p === "/Users/me/work/rove"
    const spread = [...repos, "/Users/me/work/api"]
    expect(nameOrPath("/Users/me/i/rove", spread, probe)).toBe("/Users/me/i/rove")
  })
})
