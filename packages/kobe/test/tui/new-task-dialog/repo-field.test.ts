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

import { nameOrPath, resolveRepoInput, splitRepoInput } from "@/tui/component/new-task-dialog/repo-field"
import { describe, expect, it } from "vitest"

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
})
