/**
 * Unit tests for the file tree's git wrappers (`filetree/git.ts`).
 *
 * Focus: `parseNumstat` rename handling. `git diff --numstat -z` renders
 * renames as NUL-delimited old/new path pairs. The Changes tab merges these
 * counts onto the porcelain `R` row by PATH, so the parser must resolve the
 * numstat record to the same canonical post-rename path porcelain reports —
 * otherwise a renamed file silently shows no +/- line counts.
 *
 * Also covers `parseStatusEntries` (headline collapsing), `buildTree` (dir/file
 * grouping), and the `listFiles`/`statusFiles` git-invoking wrappers, whose
 * only seam is `runWorktreeGit`/`readWorktreeFile` from `worktree/content.ts` —
 * mocked below (spreading the real module so any export the code path touches
 * that we didn't stub still resolves, per the mocking gotcha).
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("../../src/worktree/content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/worktree/content")>()
  return {
    ...actual,
    runWorktreeGit: vi.fn(),
    readWorktreeFile: vi.fn(),
    readLocalWorktreeHead: vi.fn(() => null),
  }
})

import {
  attachUntrackedChildren,
  listFiles,
  parseNameStatus,
  parseNumstat,
  parseStatusEntries,
  resetBaseCache,
  resolveBase,
  statusFiles,
  statusFilesBranch,
} from "../../src/tui/panes/filetree/git"
import { readLocalWorktreeHead, readWorktreeFile, runWorktreeGit } from "../../src/worktree/content"

const runGit = vi.mocked(runWorktreeGit)
const readFile = vi.mocked(readWorktreeFile)
const localHead = vi.mocked(readLocalWorktreeHead)

function ok(stdout: string): { stdout: string; stderr: string; status: number } {
  return { stdout, stderr: "", status: 0 }
}
function fail(stderr = "boom"): { stdout: string; stderr: string; status: number } {
  return { stdout: "", stderr, status: 1 }
}

type GitResult = ReturnType<typeof ok>
type Route = readonly [match: (args: readonly string[]) => boolean, result: GitResult]
/** Matches when every word is one of git's argv elements. */
const has =
  (...words: string[]) =>
  (args: readonly string[]) =>
    words.every((w) => args.includes(w))
const sub = (cmd: string) => (args: readonly string[]) => args[0] === cmd
const any = () => true

/** Fake git: the first matching route answers; an unmatched call throws. */
function routeGit(...routes: Route[]): void {
  runGit.mockImplementation(async (_cwd, args) => {
    const hit = routes.find(([match]) => match(args))
    if (!hit) throw new Error(`unexpected args ${args.join(" ")}`)
    return hit[1]
  })
}

/** No remote at all: every origin/* probe fails. */
const NO_REMOTE: Route[] = [
  [has("symbolic-ref"), fail("no origin/HEAD")],
  [has("origin/main"), fail("no such ref")],
  [has("origin/master"), fail("no such ref")],
]

beforeEach(() => {
  resetBaseCache()
  runGit.mockReset()
  readFile.mockReset()
  localHead.mockReset()
  localHead.mockReturnValue(null)
})

describe("parseNumstat", () => {
  test("parses a plain modified file", () => {
    expect(parseNumstat("3\t2\tsrc/app.ts\0")).toEqual([{ path: "src/app.ts", added: 3, deleted: 2 }])
  })

  // ── Rename forms (the bug this file pins) ────────────────────────────────
  // With `-z`, git emits the source and destination paths as separate NUL-delimited
  // fields; the canonical NEW path must match what `git status --porcelain`
  // reports as the `R` row's path.

  test("resolves a cross-directory rename", () => {
    // git: `0\t0\t\0dir/x.txt\0other/x.txt\0`  (porcelain row: `other/x.txt`)
    expect(parseNumstat("0\t0\t\0dir/x.txt\0other/x.txt\0")).toEqual([{ path: "other/x.txt", added: 0, deleted: 0 }])
  })

  test("resolves a root-level rename", () => {
    // git: `0\t0\t\0root1.txt\0root2.txt\0`  (porcelain row: `root2.txt`)
    expect(parseNumstat("0\t0\t\0root1.txt\0root2.txt\0")).toEqual([{ path: "root2.txt", added: 0, deleted: 0 }])
  })

  test("keeps content-change counts on a renamed-and-edited file", () => {
    expect(parseNumstat("8\t1\t\0src/a.ts\0src/b.ts\0")).toEqual([{ path: "src/b.ts", added: 8, deleted: 1 }])
  })
})

describe("parseStatusEntries", () => {
  test("collapses to worktree status when present, else index status", () => {
    expect(parseStatusEntries(" M a.ts\nM  b.ts\n")).toEqual([
      { path: "a.ts", status: "M" },
      { path: "b.ts", status: "M" },
    ])
  })

  test("reports untracked rows as ?", () => {
    expect(parseStatusEntries("?? new.txt\n")).toEqual([{ path: "new.txt", status: "?" }])
  })

  test("keeps only the new path for a rename row", () => {
    expect(parseStatusEntries("R  old.txt -> new.txt\n")).toEqual([{ path: "new.txt", status: "R" }])
  })

  test("skips a row whose collapsed status is unrecognized", () => {
    // "!" is git's ignored-file marker in porcelain v2 extensions; v1 never
    // emits it, so this exercises the "skip rather than display garbage" branch.
    expect(parseStatusEntries("!! ignored.txt\n")).toEqual([])
  })

  test("keeps an untracked directory row as a collapsed entry", () => {
    expect(parseStatusEntries("?? dir/\n")).toEqual([{ path: "dir/", status: "?" }])
  })

  test("skips a trailing-slash row for any tracked status defensively", () => {
    expect(parseStatusEntries("D  dir/\n")).toEqual([])
  })

  test("empty input yields no entries", () => {
    expect(parseStatusEntries("")).toEqual([])
  })
})

describe("attachUntrackedChildren", () => {
  test("attaches the untracked files beneath each untracked dir row", () => {
    const entries = [
      { path: "a.ts", status: "M" as const },
      { path: "assets/", status: "?" as const },
    ]
    attachUntrackedChildren(entries, ["assets/x.png", "assets/sub/y.png", "loose.txt"])
    expect(entries[1]).toEqual({
      path: "assets/",
      status: "?",
      children: [
        { path: "assets/x.png", status: "?" },
        { path: "assets/sub/y.png", status: "?" },
      ],
    })
    // Non-dir rows are untouched.
    expect(entries[0]).toEqual({ path: "a.ts", status: "M" })
  })
})

describe("listFiles", () => {
  test("de-dupes and sorts the ls-files output", () => {
    runGit.mockResolvedValue(ok("b.ts\na.ts\na.ts\n"))
    return listFiles("/repo").then((files) => {
      expect(files).toEqual(["a.ts", "b.ts"])
      expect(runGit).toHaveBeenCalledWith(
        "/repo",
        ["ls-files", "--cached", "--others", "--exclude-standard", "--full-name"],
        { signal: undefined },
      )
    })
  })

  test("throws with a descriptive message on non-zero exit", async () => {
    runGit.mockResolvedValue(fail("not a git repo"))
    await expect(listFiles("/repo")).rejects.toThrow(/not a git repo/)
  })

  test("strips trailing CR and drops blank lines", async () => {
    runGit.mockResolvedValue(ok("a.ts\r\n\nb.ts\r\n"))
    expect(await listFiles("/repo")).toEqual(["a.ts", "b.ts"])
  })
})

describe("statusFiles", () => {
  test("merges numstat counts onto porcelain rows by path", async () => {
    routeGit([sub("status"), ok(" M a.ts\n")], [has("diff", "-z"), ok("3\t1\ta.ts\0")])
    const rows = await statusFiles("/repo")
    expect(rows).toEqual([{ path: "a.ts", status: "M", added: 3, deleted: 1 }])
  })

  test("collapses an untracked dir to one row with children + summed counts", async () => {
    routeGit(
      [sub("status"), ok(" M a.ts\n?? assets/\n")],
      [has("diff", "-z"), ok("3\t1\ta.ts\0")],
      [sub("ls-files"), ok("assets/x.txt\nassets/y.bin\n")],
    )
    readFile.mockImplementation(async (_cwd, rel) => (rel === "assets/x.txt" ? "one\ntwo\n" : "\u0000binary"))
    const rows = await statusFiles("/repo")
    expect(rows).toEqual([
      { path: "a.ts", status: "M", added: 3, deleted: 1 },
      {
        path: "assets/",
        status: "?",
        added: 2,
        deleted: 0,
        children: [
          { path: "assets/x.txt", status: "?", added: 2, deleted: 0 },
          { path: "assets/y.bin", status: "?" },
        ],
      },
    ])
  })

  test("falls back to the cached diff when `diff HEAD` fails (unborn branch)", async () => {
    routeGit(
      [sub("status"), ok("A  new.ts\n")],
      [has("HEAD"), fail("no HEAD")],
      [has("--cached", "-z"), ok("5\t0\tnew.ts\0")],
    )
    const rows = await statusFiles("/repo")
    expect(rows).toEqual([{ path: "new.ts", status: "A", added: 5, deleted: 0 }])
  })

  test("leaves stats empty when both diff attempts fail", async () => {
    routeGit([sub("status"), ok("A  new.ts\n")], [any, fail("no HEAD, no index")])
    const rows = await statusFiles("/repo")
    expect(rows).toEqual([{ path: "new.ts", status: "A" }])
  })

  test("counts on-disk lines for untracked files missing from numstat", async () => {
    routeGit([sub("status"), ok("?? untracked.txt\n")], [sub("diff"), ok("")])
    readFile.mockResolvedValue("line1\nline2\nline3")
    const rows = await statusFiles("/repo")
    expect(rows).toEqual([{ path: "untracked.txt", status: "?", added: 3, deleted: 0 }])
  })

  test("leaves an untracked file's counts blank when the on-disk read fails", async () => {
    routeGit([sub("status"), ok("?? gone.txt\n")], [sub("diff"), ok("")])
    readFile.mockResolvedValue(null)
    const rows = await statusFiles("/repo")
    expect(rows).toEqual([{ path: "gone.txt", status: "?" }])
  })
})

describe("parseNameStatus", () => {
  test("maps M/A/D headlines and keeps the new path for renames", () => {
    const raw = "M\tsrc/a.ts\nA\tsrc/b.ts\nD\told.ts\nR094\tsrc/old.ts\tsrc/new.ts\n"
    expect(parseNameStatus(raw)).toEqual([
      { status: "M", path: "src/a.ts" },
      { status: "A", path: "src/b.ts" },
      { status: "D", path: "old.ts" },
      { status: "R", path: "src/new.ts" },
    ])
  })

  test("drops unknown codes and directory rows", () => {
    expect(parseNameStatus("X\tweird.ts\nM\treal.ts\n")).toEqual([{ status: "M", path: "real.ts" }])
  })
})

describe("statusFilesBranch", () => {
  test("merges name-status headlines with numstat counts over base...HEAD", async () => {
    // Three-dot merge-base range, never a literal $(merge-base) subshell.
    routeGit(
      [has("--name-status", "origin/main...HEAD"), ok("M\tsrc/a.ts\nA\tsrc/b.ts\n")],
      [has("--numstat", "-z", "origin/main...HEAD"), ok("3\t1\tsrc/a.ts\0" + "10\t0\tsrc/b.ts\0")],
    )
    const rows = await statusFilesBranch("/repo", "origin/main")
    expect(rows).toEqual([
      { path: "src/a.ts", status: "M", added: 3, deleted: 1 },
      { path: "src/b.ts", status: "A", added: 10, deleted: 0 },
    ])
  })
})

describe("resolveBase", () => {
  test("prefers an explicit PR base ref", async () => {
    expect(await resolveBase("/repo", "origin/release")).toBe("origin/release")
  })

  test("falls back to origin/HEAD, then origin/main", async () => {
    routeGit(
      [has("symbolic-ref"), fail("no origin/HEAD")],
      [has("rev-parse", "origin/main"), ok("")],
      [any, fail("nope")],
    )
    expect(await resolveBase("/repo")).toBe("origin/main")
  })

  test("returns null when nothing resolves", async () => {
    runGit.mockImplementation(async () => fail("detached, no remote"))
    expect(await resolveBase("/repo")).toBeNull()
  })

  // A repo with no remote used to resolve no base at all, which made Branch
  // scope unreachable: an attempt that had committed everything showed
  // `no changes — clean worktree` beside a sidebar row reading `↑1`.
  test("falls back to a LOCAL default branch when the repo has no remote", async () => {
    routeGit(...NO_REMOTE, [has("HEAD"), ok("aaaaaaa\n")], [has("main"), ok("bbbbbbb\n")], [any, fail("nope")])
    expect(await resolveBase("/repo")).toBe("main")
  })

  // `main...HEAD` is empty by construction when `main` IS this HEAD, so
  // offering it would move the empty pane behind a toggle rather than say
  // there is nothing to compare against.
  test("skips a local default branch that is this worktree's own HEAD", async () => {
    routeGit(...NO_REMOTE, [has("HEAD"), ok("samesha\n")], [has("main"), ok("samesha\n")], [any, fail("nope")])
    expect(await resolveBase("/repo")).toBeNull()
  })
  // Every task switch remounts the pane; the ladder was six `git` spawns each time.
  test("reuses a base across mounts until HEAD moves", async () => {
    const withHead = (head: string) =>
      routeGit(...NO_REMOTE, [has("HEAD"), ok(head)], [has("main"), ok("samesha\n")], [any, fail("nope")])
    withHead("samesha\n")
    expect(await resolveBase("/repo")).toBeNull()
    runGit.mockClear()
    expect(await resolveBase("/repo")).toBeNull()
    expect(runGit).toHaveBeenCalledTimes(1)

    withHead("newcommit\n")
    expect(await resolveBase("/repo")).toBe("main")
  })

  test("a remount with HEAD readable from disk spawns no git", async () => {
    localHead.mockReturnValue("samesha")
    routeGit(...NO_REMOTE, [has("HEAD"), ok("samesha\n")], [has("main"), ok("samesha\n")], [any, fail("nope")])
    expect(await resolveBase("/repo")).toBeNull()
    runGit.mockClear()
    expect(await resolveBase("/repo")).toBeNull()
    expect(runGit).not.toHaveBeenCalled()

    localHead.mockReturnValue("newcommit")
    routeGit(...NO_REMOTE, [has("HEAD"), ok("newcommit\n")], [has("main"), ok("samesha\n")], [any, fail("nope")])
    expect(await resolveBase("/repo")).toBe("main")
  })

  test("does not remember a ladder that was aborted mid-way", async () => {
    const controller = new AbortController()
    runGit.mockImplementation(async () => {
      controller.abort()
      return fail("aborted")
    })
    expect(await resolveBase("/repo", undefined, controller.signal)).toBeNull()
    routeGit([has("symbolic-ref"), ok("origin/main\n")], [any, fail()])
    expect(await resolveBase("/repo")).toBe("origin/main")
  })
})
