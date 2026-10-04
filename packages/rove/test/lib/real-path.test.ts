import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { realPathOrSelf } from "@/lib/real-path"
import { describe, expect, it } from "vitest"

describe("realPathOrSelf", () => {
  it("resolves symlinks and keeps a missing path as given", () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "real-path-")))
    mkdirSync(path.join(dir, "real"))
    symlinkSync(path.join(dir, "real"), path.join(dir, "link"))
    expect(realPathOrSelf(path.join(dir, "link"))).toBe(path.join(dir, "real"))
    expect(realPathOrSelf(path.join(dir, "missing"))).toBe(path.join(dir, "missing"))
  })
})
