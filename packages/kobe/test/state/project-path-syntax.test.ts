import { describe, expect, it } from "vitest"
import { pathRejection } from "../../src/state/project-eligibility"

describe("project admission across path spellings", () => {
  it.each([
    "C:/Projects/.scratch/demo",
    "C:\\Projects\\.scratch\\demo",
    "C:/Projects/.dev-sandbox/demo",
    "\\\\server\\share\\.dev-sandbox\\demo",
  ])("rejects sandbox paths: %s", (repo) => {
    expect(pathRejection(repo, "explicit")).toBe("insideSandbox")
  })

  it("preserves remote keys and POSIX backslash names", () => {
    expect(pathRejection("ssh://host/srv/.scratch/demo", "explicit")).toBeNull()
    expect(pathRejection("/srv/project\\.scratch/demo", "explicit")).toBeNull()
  })
})
