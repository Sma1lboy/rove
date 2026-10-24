import { describe, expect, it } from "vitest"
import { toggleExtraRepo } from "../../../src/tui-react/component/new-task-dialog/pure"
import { nextField } from "../../../src/tui/component/new-task-dialog/state"

describe("extra repos in the new-task dialog", () => {
  it("a pick goes last, a second pick of it removes it, and a pick past the cap is ignored", () => {
    expect(toggleExtraRepo(["/a"], "/b", 7)).toEqual(["/a", "/b"])
    expect(toggleExtraRepo(["/a", "/b", "/c"], "/b", 7)).toEqual(["/a", "/c"])
    const full = ["/1", "/2", "/3"]
    expect(toggleExtraRepo(full, "/4", 3)).toEqual(full)
  })

  it("Tab reaches the extras list only while it renders, between the repo and the intent/branch fields", () => {
    expect(nextField("repo", "existing")).toBe("baseRef")
    expect(nextField("repo", "existing", { extrasVisible: true })).toBe("extras")
    expect(nextField("extras", "existing", { extrasVisible: true })).toBe("baseRef")
    expect(nextField("extras", "existing", { extrasVisible: true, intentVisible: true })).toBe("intent")
    expect(nextField("repo", "existing", { extrasVisible: true, intentVisible: true })).toBe("extras")
  })
})
