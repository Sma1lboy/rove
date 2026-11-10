import { describe, expect, test } from "bun:test"
import { effort, foldedByDefault, groupOf, orderByGroup } from "../src/review-shape.ts"

describe("review shape", () => {
  test("files fall into groups; lockfiles and generated output fold by default", () => {
    expect(groupOf("src/a.ts")).toBe("source")
    expect(groupOf("test/a.test.ts")).toBe("tests")
    expect(groupOf("biome.json")).toBe("config")
    expect(groupOf("docs/API.md")).toBe("docs")
    expect(groupOf("bun.lock")).toBe("generated")
    expect(foldedByDefault("packages/x/dist/app.js")).toBe(true)
    expect(foldedByDefault("src/a.ts")).toBe(false)
  })

  test("effort rises with files and lines, and ignores a huge lockfile", () => {
    expect(effort([{ path: "a.ts", lines: 5 }])).toBe(1)
    expect(
      effort([
        { path: "a.ts", lines: 5 },
        { path: "bun.lock", lines: 9000 },
      ]),
    ).toBe(1)
    expect(effort(Array.from({ length: 8 }, (_, i) => ({ path: `s/${i}.ts`, lines: 20 })))).toBe(3)
    expect(effort([{ path: "a.ts", lines: 5000 }])).toBe(5)
  })

  test("a combined diff lists source first and generated last, files intact", () => {
    const rows = [
      { kind: "file", path: "bun.lock" },
      { kind: "add", path: "bun.lock" },
      { kind: "file", path: "a.test.ts" },
      { kind: "file", path: "src/a.ts" },
      { kind: "add", path: "src/a.ts" },
    ]
    expect(orderByGroup(rows).map((r) => r.path)).toEqual(["src/a.ts", "src/a.ts", "a.test.ts", "bun.lock", "bun.lock"])
  })
})
