import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FILE_READ_MAX_BYTES, readPreviewFile } from "../../src/worktree/file-read.ts"

let base: string
let tree: string
let outside: string

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "rove-file-read-")))
  tree = join(base, "tree")
  outside = join(base, "outside")
  mkdirSync(join(tree, "docs"), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(tree, "docs", "report.md"), "# hi")
  writeFileSync(join(outside, "secret.md"), "secret")
  writeFileSync(join(tree, "notes.txt"), "plain")
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

const refused = async (rel: string): Promise<string | undefined> =>
  readPreviewFile(tree, rel).then(
    () => undefined,
    (err: { code?: string }) => err.code,
  )

describe("readPreviewFile", () => {
  it("returns an allowlisted file's bytes with its type", async () => {
    const file = await readPreviewFile(tree, "docs/report.md")
    expect(file).toEqual({
      path: "docs/report.md",
      mime: "text/markdown",
      size: 4,
      base64: Buffer.from("# hi").toString("base64"),
    })
  })

  it("refuses a path that is absolute, climbs out, or is empty", async () => {
    expect(await refused(join(outside, "secret.md"))).toBe("BAD_ARGS")
    expect(await refused("../outside/secret.md")).toBe("BAD_ARGS")
    expect(await refused("docs/../../outside/secret.md")).toBe("BAD_ARGS")
    expect(await refused("")).toBe("BAD_ARGS")
  })

  it("refuses a symlink that points out of the worktree, file or directory", async () => {
    symlinkSync(join(outside, "secret.md"), join(tree, "link.md"))
    symlinkSync(outside, join(tree, "linkdir"))
    expect(await refused("link.md")).toBe("BAD_ARGS")
    expect(await refused("linkdir/secret.md")).toBe("BAD_ARGS")
  })

  it("follows a symlink that stays inside, typed by its target", async () => {
    symlinkSync(join(tree, "docs", "report.md"), join(tree, "alias.png"))
    const file = await readPreviewFile(tree, "alias.png")
    expect(file.mime).toBe("text/markdown")
  })

  it("refuses a type it cannot preview, a missing file, a directory and an over-cap file", async () => {
    expect(await refused("notes.txt")).toBe("NOT_PREVIEWABLE")
    expect(await refused("nope.md")).toBe("NOT_FOUND")
    mkdirSync(join(tree, "dir.md"))
    expect(await refused("dir.md")).toBe("NOT_PREVIEWABLE")
    writeFileSync(join(tree, "big.pdf"), Buffer.alloc(FILE_READ_MAX_BYTES + 1))
    expect(await refused("big.pdf")).toBe("TOO_LARGE")
    writeFileSync(join(tree, "edge.pdf"), Buffer.alloc(FILE_READ_MAX_BYTES))
    expect((await readPreviewFile(tree, "edge.pdf")).size).toBe(FILE_READ_MAX_BYTES)
  })
})
