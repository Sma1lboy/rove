/**
 * The file tree's row-building pures that filetree-rows.test.ts leaves out
 * (`flattenTree` / `statusRows` / `truncatePathTail`) plus the sidebar's
 * `readWorktreeChanges` — the 2s-poll git status reader — against a real
 * temp repo (its contract is exit-code + porcelain parsing; a mocked git
 * would test nothing).
 */

import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { type Row, flattenTree, statusRows, truncatePathTail } from "../../src/tui/panes/filetree/rows.ts"
import type { TreeNode } from "../../src/tui/panes/filetree/tree.ts"
import { readWorktreeChanges } from "../../src/tui/panes/sidebar/worktree-changes.ts"

describe("flattenTree", () => {
  const tree: TreeNode = {
    path: "",
    name: "",
    isDir: true,
    children: [
      {
        path: "src",
        name: "src",
        isDir: true,
        children: [
          { path: "src/a.ts", name: "a.ts", isDir: false, children: [] },
          { path: "src/lib", name: "lib", isDir: true, children: [] },
        ],
      },
      { path: "README.md", name: "README.md", isDir: false, children: [] },
    ],
  }

  test("collapsed dirs render as one row; their children stay hidden", () => {
    const out: Row[] = []
    flattenTree(tree, new Set(), 0, out)
    expect(out).toEqual([
      { kind: "dir", path: "src", name: "src", depth: 0, expanded: false, hasChildren: true },
      { kind: "file", path: "README.md", name: "README.md", depth: 0 },
    ])
  })

  test("an expanded dir contributes its children at depth+1, empty dirs report hasChildren:false", () => {
    const out: Row[] = []
    flattenTree(tree, new Set(["src"]), 0, out)
    expect(out).toEqual([
      { kind: "dir", path: "src", name: "src", depth: 0, expanded: true, hasChildren: true },
      { kind: "file", path: "src/a.ts", name: "a.ts", depth: 1 },
      { kind: "dir", path: "src/lib", name: "lib", depth: 1, expanded: false, hasChildren: false },
      { kind: "file", path: "README.md", name: "README.md", depth: 0 },
    ])
  })
})

describe("statusRows / truncatePathTail", () => {
  test("maps status entries to Changes-tab rows verbatim", () => {
    expect(statusRows([{ path: "a.ts", status: "M", added: 3, deleted: 1 }])).toEqual([
      { kind: "status", path: "a.ts", status: "M", added: 3, deleted: 1 },
    ])
  })

  test("renders an untracked dir collapsed with a count, children only when expanded", () => {
    const entries = [
      {
        path: "assets/",
        status: "?" as const,
        added: 2,
        deleted: 0,
        children: [{ path: "assets/x.png", status: "?" as const }],
      },
    ]
    expect(statusRows(entries)).toEqual([
      { kind: "status", path: "assets/", status: "?", added: 2, deleted: 0, fileCount: 1, expanded: false },
    ])
    expect(statusRows(entries, new Set(["assets/"]))).toEqual([
      { kind: "status", path: "assets/", status: "?", added: 2, deleted: 0, fileCount: 1, expanded: true },
      { kind: "status", path: "assets/x.png", status: "?", added: undefined, deleted: undefined, child: true },
    ])
  })

  test("keeps the path TAIL when truncating (the filename carries the meaning)", () => {
    const truncated = truncatePathTail("src/components/sidebar/Sidebar.tsx", 20)
    expect(truncated.endsWith("Sidebar.tsx")).toBe(true)
    expect(truncated.length).toBeLessThanOrEqual(20)
  })
})

describe("readWorktreeChanges", () => {
  let repo: string

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "kobe-wt-changes-"))
    execSync("git init -q -b main && git commit -q --allow-empty -m init", {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    })
  })

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  // The three failure branches must be UNKNOWN, never `{0,0}`: `{0,0}` is the
  // real answer for a clean worktree, and `collect` documents non-zero as
  // "cannot land", so a fabricated zero reads as safe to land / safe to delete.
  test("returns null — not zeros — when the counts cannot be read", () => {
    expect(readWorktreeChanges("")).toBeNull()
    const notRepo = mkdtempSync(join(tmpdir(), "kobe-not-repo-"))
    try {
      // git exits non-zero outside a repo.
      expect(readWorktreeChanges(notRepo)).toBeNull()
    } finally {
      rmSync(notRepo, { recursive: true, force: true })
    }
    // A directory that does not exist at all makes the spawn itself throw.
    expect(readWorktreeChanges(join(tmpdir(), "rove-definitely-not-here-xyz"))).toBeNull()
  })

  test("a genuinely clean worktree still reads as zeros, not unknown", () => {
    expect(readWorktreeChanges(repo)).toEqual({ added: 0, deleted: 0 })
  })

  test("counts untracked and modified files from real porcelain output", () => {
    writeFileSync(join(repo, "new.txt"), "hello")
    mkdirSync(join(repo, "sub"), { recursive: true })
    writeFileSync(join(repo, "sub", "extra.txt"), "hi")
    const changes = readWorktreeChanges(repo)
    expect(changes?.added).toBeGreaterThan(0)
    expect(changes?.deleted).toBe(0)
  })
})
