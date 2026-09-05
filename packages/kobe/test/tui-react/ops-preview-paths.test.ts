import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { loadPreviewData, unifiedDiffFiles } from "../../src/tui/ops/preview-core"

function fixture(files: Record<string, string>) {
  const repo = mkdtempSync(join(tmpdir(), "rove-preview-paths-"))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" })
  const write = (path: string, body: string) => writeFileSync(join(repo, path), body)
  git("init", "-q")
  for (const [path, body] of Object.entries(files)) write(path, body)
  git("add", ".")
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture")
  return { repo, git, write }
}

describe("preview uses the selected literal git path", () => {
  test.each([
    ["a[1].txt", "a1.txt"],
    ["a*.txt", "abc.txt"],
    ["a?.txt", "ab.txt"],
    [":(glob)*.txt", "other.txt"],
    ["空 格[1].txt", "空 格1.txt"],
  ])("%s never previews %s", async (selected, other) => {
    const { repo, write } = fixture({ [selected]: "selected old\n", [other]: "other old\n" })
    write(selected, "selected new\n")
    write(other, "other new\n")
    const data = await loadPreviewData(repo, selected)
    expect(data.kind).toBe("diff")
    if (data.kind !== "diff") throw new Error("expected diff")
    expect(unifiedDiffFiles(data.text).map((file) => file.path)).toEqual([selected])
    expect(data.text).toContain("+selected new")
    expect(data.text).not.toContain("other new")
  })

  test("rename pairing keeps literal source and destination paths", async () => {
    const source = "old[1].txt"
    const target = "new?.txt"
    const content = Array.from({ length: 20 }, (_, i) => `line ${i}\n`).join("")
    const { repo, git, write } = fixture({ [source]: content, "old1.txt": "other\n", "new1.txt": "other\n" })
    git("mv", source, target)
    write(target, `${content}new line\n`)
    write("old1.txt", "wrong old\n")
    write("new1.txt", "wrong new\n")
    const data = await loadPreviewData(repo, target)
    expect(data.kind).toBe("diff")
    if (data.kind !== "diff") throw new Error("expected diff")
    expect(data.origPath).toBe(source)
    expect(unifiedDiffFiles(data.text).map((file) => file.path)).toEqual([target])
    expect(data.text).not.toContain("wrong")
  })

  test("literal directory and whole worktree still aggregate their files", async () => {
    const { repo, git, write } = fixture({ "root.txt": "root\n" })
    mkdirSync(join(repo, "dir[1]"))
    mkdirSync(join(repo, "dir1"))
    write("dir[1]/a.txt", "a\n")
    write("dir[1]/b.txt", "b\n")
    write("dir1/other.txt", "other\n")
    git("add", ".")
    const directory = await loadPreviewData(repo, "dir[1]/")
    const all = await loadPreviewData(repo, ".")
    if (directory.kind !== "diff" || all.kind !== "diff") throw new Error("expected combined diffs")
    expect(unifiedDiffFiles(directory.text).map((file) => file.path)).toEqual(["dir[1]/a.txt", "dir[1]/b.txt"])
    expect(unifiedDiffFiles(all.text)).toHaveLength(3)
  })
})

describe("hunkless patches", () => {
  test("pure Unicode rename states its source and labels its destination in combined diffs", async () => {
    const { repo, git } = fixture({ "old file.txt": "same\n" })
    git("mv", "old file.txt", "新 文件.txt")
    const note = { kind: "rename", from: "old file.txt", to: "新 文件.txt" }
    expect(await loadPreviewData(repo, "新 文件.txt")).toMatchObject({ kind: "patch-note", note })
    const all = await loadPreviewData(repo, ".")
    if (all.kind !== "diff") throw new Error("expected diff")
    expect(unifiedDiffFiles(all.text)).toMatchObject([{ path: "新 文件.txt", lines: 0, note }])
  })

  test.each(["added", "deleted"] as const)("empty file %s differs from no changes", async (change) => {
    const { repo, git, write } = fixture({ "kept.txt": "kept\n", ...(change === "deleted" ? { "empty.txt": "" } : {}) })
    if (change === "added") {
      write("empty.txt", "")
      git("add", "empty.txt")
    } else git("rm", "empty.txt")
    expect(await loadPreviewData(repo, "empty.txt")).toMatchObject({
      kind: "patch-note",
      note: { kind: "empty-file", change },
    })
    const all = await loadPreviewData(repo, ".")
    if (all.kind !== "diff") throw new Error("expected diff")
    expect(unifiedDiffFiles(all.text)).toMatchObject([
      { path: "empty.txt", lines: 0, note: { kind: "empty-file", change } },
    ])
  })
})

describe("failed reads are not empty files or clean diffs", () => {
  test("missing file differs from valid empty content", async () => {
    const { repo, write } = fixture({ "kept.txt": "kept\n" })
    write("empty.txt", "")
    expect(await loadPreviewData(repo, "empty.txt")).toEqual({ kind: "code", text: "" })
    expect(await loadPreviewData(repo, "missing.txt")).toMatchObject({ kind: "error" })
  })

  test.skipIf(process.getuid?.() === 0)("unreadable file makes both single and combined previews fail", async () => {
    const { repo } = fixture({ "blocked.txt": "blocked\n" })
    chmodSync(join(repo, "blocked.txt"), 0)
    try {
      expect(await loadPreviewData(repo, "blocked.txt")).toMatchObject({ kind: "error" })
      expect(await loadPreviewData(repo, ".")).toMatchObject({ kind: "error" })
    } finally {
      chmodSync(join(repo, "blocked.txt"), 0o644)
    }
  })
})
