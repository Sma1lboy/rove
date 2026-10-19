import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
  beginFileListFetch,
  cachedFileList,
  freshFileList,
  rememberFileList,
} from "../../src/tui/panes/filetree/file-list-cache"

describe("file list cache freshness", () => {
  const dirs: string[] = []
  afterEach(() => {
    vi.useRealTimers()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function worktree(): string {
    const dir = mkdtempSync(join(tmpdir(), "rove-file-list-"))
    dirs.push(dir)
    return dir
  }

  test("a list fetched before the watch settles is cached but never fresh", () => {
    const path = worktree()
    rememberFileList(path, ["a.ts"], beginFileListFetch(path))
    expect(cachedFileList(path)).toEqual(["a.ts"])
    expect(freshFileList(path)).toBeNull()
  })

  test("a settled, watched list stays fresh until a file changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const path = worktree()
    beginFileListFetch(path)
    vi.setSystemTime(Date.now() + 2_000)
    rememberFileList(path, ["a.ts"], beginFileListFetch(path))
    expect(freshFileList(path)).toEqual(["a.ts"])

    writeFileSync(join(path, "b.ts"), "")
    await vi.waitFor(() => expect(freshFileList(path)).toBeNull(), { timeout: 3_000 })
    expect(cachedFileList(path)).toEqual(["a.ts"])
  })
})
