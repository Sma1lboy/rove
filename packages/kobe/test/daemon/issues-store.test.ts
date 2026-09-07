import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IssuesStore } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { afterEach, describe, expect, it } from "vitest"

const cleanups: string[] = []

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "kobe-issues-store-"))
  cleanups.push(repo)
  execFileSync("git", ["init", "--quiet"], { cwd: repo })
  await writeFile(join(repo, "README.md"), "fixture\n", "utf8")
  execFileSync("git", ["add", "."], { cwd: repo })
  execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "--quiet", "-m", "fixture"],
    {
      cwd: repo,
    },
  )
  return repo
}

afterEach(async () => {
  while (cleanups.length) {
    await rm(cleanups.pop()!, { recursive: true, force: true })
  }
})

describe("IssuesStore", () => {
  it("rejects plain directories with a clean non-git error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kobe-issues-store-plain-"))
    cleanups.push(dir)
    const storePath = join(dir, "home", ".kobe", "issues.json")
    const store = new IssuesStore(storePath)

    await expect(store.list(dir)).rejects.toThrow("repoRoot is not a git repository")
  })

  it("shares daemon issue state across git worktrees", async () => {
    const repo = await makeRepo()
    const parent = await mkdtemp(join(tmpdir(), "kobe-issues-store-wt-"))
    cleanups.push(parent)
    const worktree = join(parent, "task")
    execFileSync("git", ["worktree", "add", "--quiet", worktree, "-b", "task"], { cwd: repo })

    const storePath = join(parent, "home", ".kobe", "issues.json")
    const store = new IssuesStore(storePath)
    const canonicalRepo = await realpath(repo)

    await expect(store.list(repo)).resolves.toMatchObject({
      repoRoot: canonicalRepo,
      exists: false,
      nextId: 1,
      issues: [],
    })
    await store.mutate(repo, { type: "create", title: "Daemon issue", body: "shared state" })
    await expect(store.mutate(worktree, { type: "setStatus", id: 1, status: "done" })).resolves.toMatchObject({
      repoRoot: canonicalRepo,
      issues: [{ id: 1, status: "done" }],
    })

    await expect(store.list(repo)).resolves.toMatchObject({
      repoRoot: canonicalRepo,
      exists: true,
      nextId: 2,
      issues: [{ id: 1, title: "Daemon issue", status: "done", body: "shared state" }],
    })
    await expect(store.list(worktree)).resolves.toMatchObject({
      repoRoot: canonicalRepo,
      exists: true,
      nextId: 2,
      issues: [{ id: 1, title: "Daemon issue", status: "done", body: "shared state" }],
    })
  })

  it("does not drop mutations when two different repos write concurrently", async () => {
    // The store holds ALL repos in one file, read/written whole. Two repos'
    // read-modify-write cycles must serialize on the FILE, not the repoKey —
    // otherwise one cycle reads the file before the other's rename lands, and
    // its own write clobbers the other repo's just-created issue. Fire many
    // interleaved creates per repo so the read/write windows reliably overlap;
    // every create must survive.
    const repoA = await makeRepo()
    const repoB = await makeRepo()
    const parent = await mkdtemp(join(tmpdir(), "kobe-issues-store-conc-"))
    cleanups.push(parent)
    const store = new IssuesStore(join(parent, "home", ".kobe", "issues.json"))

    const N = 15
    const ops: Promise<unknown>[] = []
    for (let i = 0; i < N; i++) {
      ops.push(store.mutate(repoA, { type: "create", title: `A${i}` }))
      ops.push(store.mutate(repoB, { type: "create", title: `B${i}` }))
    }
    await Promise.all(ops)

    await expect(store.list(repoA)).resolves.toMatchObject({ exists: true, nextId: N + 1 })
    await expect(store.list(repoB)).resolves.toMatchObject({ exists: true, nextId: N + 1 })
    expect((await store.list(repoA)).issues).toHaveLength(N)
    expect((await store.list(repoB)).issues).toHaveLength(N)
  })

  it("migrates a stored worktree repoRoot back to the main worktree on list", async () => {
    const repo = await makeRepo()
    const parent = await mkdtemp(join(tmpdir(), "kobe-issues-store-wt-"))
    cleanups.push(parent)
    const worktree = join(parent, "task")
    execFileSync("git", ["worktree", "add", "--quiet", worktree, "-b", "task"], { cwd: repo })

    const storePath = join(parent, "home", ".kobe", "issues.json")
    const store = new IssuesStore(storePath)
    const canonicalRepo = await realpath(repo)

    await store.mutate(worktree, { type: "create", title: "From worktree" })
    const before = JSON.parse(await readFile(storePath, "utf8")) as {
      repos: Record<string, { repoRoot: string }>
    }
    expect(Object.values(before.repos)[0]?.repoRoot).toBe(canonicalRepo)

    await writeFile(
      storePath,
      `${JSON.stringify(
        {
          version: 1,
          repos: Object.fromEntries(
            Object.entries(before.repos).map(([key, value]) => [key, { ...value, repoRoot: worktree }]),
          ),
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    await expect(store.list(worktree)).resolves.toMatchObject({
      repoRoot: canonicalRepo,
      exists: true,
      issues: [{ id: 1, title: "From worktree" }],
    })

    const after = JSON.parse(await readFile(storePath, "utf8")) as {
      repos: Record<string, { repoRoot: string }>
    }
    expect(Object.values(after.repos)[0]?.repoRoot).toBe(canonicalRepo)
  })

  // `update` carries the link so the CLI's `--title X --task Y` is ONE locked
  // write. Split across two ops, a rejected link left the rename committed.
  describe("update carrying a taskId", () => {
    async function seeded(): Promise<{ repo: string; store: IssuesStore }> {
      const repo = await makeRepo()
      const home = await mkdtemp(join(tmpdir(), "kobe-issues-store-update-link-"))
      cleanups.push(home)
      const store = new IssuesStore(join(home, ".kobe", "issues.json"))
      await store.mutate(repo, { type: "create", title: "Story", body: "B1" })
      return { repo, store }
    }

    it("applies title, body and the link in one write", async () => {
      const { repo, store } = await seeded()
      await store.mutate(repo, { type: "update", id: 1, title: "Renamed", body: "B2", taskId: "task-abc" })
      expect((await store.list(repo)).issues[0]).toMatchObject({ title: "Renamed", body: "B2", taskId: "task-abc" })
    })

    it("taskId null unlinks; absent leaves the link alone", async () => {
      const { repo, store } = await seeded()
      await store.mutate(repo, { type: "update", id: 1, taskId: "task-abc" })
      await store.mutate(repo, { type: "update", id: 1, title: "Renamed" })
      expect((await store.list(repo)).issues[0]).toMatchObject({ title: "Renamed", taskId: "task-abc" })
      await store.mutate(repo, { type: "update", id: 1, taskId: null })
      expect((await store.list(repo)).issues[0]?.taskId).toBeUndefined()
    })

    it("a rejected taskId writes nothing — the title does not half-land", async () => {
      const { repo, store } = await seeded()
      await expect(store.mutate(repo, { type: "update", id: 1, title: "Renamed", taskId: "" })).rejects.toThrow(
        "taskId must be a non-empty string or null",
      )
      expect((await store.list(repo)).issues[0]).toMatchObject({ title: "Story", body: "B1" })
    })

    it("an update that omits body leaves a concurrently-written body alone", async () => {
      const { repo, store } = await seeded()
      // The C2 shape at the store layer: a title-only patch must not carry a
      // stale body back over what another writer put there.
      await store.mutate(repo, { type: "update", id: 1, body: "AGENT WROTE THIS" })
      await store.mutate(repo, { type: "update", id: 1, title: "Typo fixed" })
      expect((await store.list(repo)).issues[0]).toMatchObject({ title: "Typo fixed", body: "AGENT WROTE THIS" })
    })
  })

  describe("mirrorTaskDone", () => {
    async function linkedStore(): Promise<{ repo: string; store: IssuesStore }> {
      const repo = await makeRepo()
      const home = await mkdtemp(join(tmpdir(), "kobe-issues-store-mirror-"))
      cleanups.push(home)
      const store = new IssuesStore(join(home, ".kobe", "issues.json"))
      await store.mutate(repo, { type: "create", title: "Linked" })
      await store.mutate(repo, { type: "link", id: 1, taskId: "task-abc" })
      return { repo, store }
    }

    it("flips the issue linked to a task to done and returns the new state", async () => {
      const { repo, store } = await linkedStore()
      const next = await store.mirrorTaskDone(repo, "task-abc")
      expect(next?.issues.find((i) => i.id === 1)?.status).toBe("done")
    })

    it("returns null when the linked issue is already done (no re-clobber)", async () => {
      const { repo, store } = await linkedStore()
      await store.mutate(repo, { type: "setStatus", id: 1, status: "done" })
      expect(await store.mirrorTaskDone(repo, "task-abc")).toBeNull()
    })

    it("returns null when no issue is linked to the task", async () => {
      const { repo, store } = await linkedStore()
      expect(await store.mirrorTaskDone(repo, "task-nope")).toBeNull()
    })
  })

  // The reverse of `link`, fired by `task.delete`. Nothing else clears
  // `Issue.taskId`, so without it a link outlives the task it names.
  describe("unlinkTask", () => {
    async function linkedStore(): Promise<{ repo: string; store: IssuesStore }> {
      const repo = await makeRepo()
      const home = await mkdtemp(join(tmpdir(), "kobe-issues-store-unlink-"))
      cleanups.push(home)
      const store = new IssuesStore(join(home, ".kobe", "issues.json"))
      await store.mutate(repo, { type: "create", title: "Linked" })
      await store.mutate(repo, { type: "link", id: 1, taskId: "task-abc" })
      return { repo, store }
    }

    it("clears the link of the issue pointing at the task", async () => {
      const { repo, store } = await linkedStore()
      const next = await store.unlinkTask(repo, "task-abc")
      expect(next?.issues.find((i) => i.id === 1)?.taskId).toBeUndefined()
      // Persisted, not just returned — the board re-reads from disk.
      expect((await store.list(repo)).issues.find((i) => i.id === 1)?.taskId).toBeUndefined()
    })

    it("leaves the issue otherwise untouched — status and title survive", async () => {
      const { repo, store } = await linkedStore()
      await store.mutate(repo, { type: "setStatus", id: 1, status: "doing" })
      const next = await store.unlinkTask(repo, "task-abc")
      expect(next?.issues.find((i) => i.id === 1)).toMatchObject({ title: "Linked", status: "doing" })
    })

    it("returns null when no issue is linked to that task", async () => {
      const { repo, store } = await linkedStore()
      expect(await store.unlinkTask(repo, "task-nope")).toBeNull()
    })
  })

  describe("created stamp", () => {
    // Pins the visual-fixture determinism seam: the Kanban screenshot gate
    // renders `created` on every card, so KOBE_ISSUES_TODAY must override the
    // real clock (valid YYYY-MM-DD only) or the snapshot breaks at midnight.
    it("honours a valid KOBE_ISSUES_TODAY pin and ignores a malformed one", async () => {
      const repo = await makeRepo()
      const home = await mkdtemp(join(tmpdir(), "kobe-issues-store-stamp-"))
      cleanups.push(home)
      const store = new IssuesStore(join(home, ".kobe", "issues.json"))
      const prior = process.env.KOBE_ISSUES_TODAY
      try {
        process.env.KOBE_ISSUES_TODAY = "2026-07-15"
        await store.mutate(repo, { type: "create", title: "Pinned" })
        process.env.KOBE_ISSUES_TODAY = "yesterday"
        const state = await store.mutate(repo, { type: "create", title: "Unpinned" })
        expect(state.issues.find((i) => i.title === "Pinned")?.created).toBe("2026-07-15")
        const today = new Date()
        const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
        expect(state.issues.find((i) => i.title === "Unpinned")?.created).toBe(expected)
      } finally {
        if (prior === undefined) Reflect.deleteProperty(process.env, "KOBE_ISSUES_TODAY")
        else process.env.KOBE_ISSUES_TODAY = prior
      }
    })
  })
})

/**
 * A read that drops entries must SAY it dropped them, and must not hand the
 * next `create` an id that is already in the file.
 *
 * `normalizeIssue` returns null for a non-numeric `id` while coercing every
 * OTHER bad field to a placeholder, and `readStore` filtered those nulls away
 * without counting them: a story the user filed stopped existing in every
 * read — board, CLI, everything — while still sitting on disk, with
 * `exists: true` and no warning anywhere.
 */
describe("IssuesStore corrupt-record honesty", () => {
  async function seed(
    entry: Record<string, unknown>,
    nextId: unknown,
  ): Promise<{ store: IssuesStore; repo: string; storePath: string }> {
    const repo = await realpath(await makeRepo())
    const dir = await mkdtemp(join(tmpdir(), "kobe-issues-corrupt-"))
    cleanups.push(dir)
    const storePath = join(dir, "issues.json")
    const store = new IssuesStore(storePath)
    // Create through the store so the repo key is whatever `resolveRepo`
    // derives, then hand-edit that record — the shape a crashed write or a
    // pre-numeric-id record leaves behind.
    await store.mutate(repo, { type: "create", title: "ship the thing" })
    await store.mutate(repo, { type: "create", title: "second story" })
    const raw = JSON.parse(await readFile(storePath, "utf8")) as {
      repos: Record<string, { nextId: unknown; issues: Record<string, unknown>[] }>
    }
    const key = Object.keys(raw.repos)[0]!
    raw.repos[key]!.issues[0] = { ...raw.repos[key]!.issues[0], ...entry }
    raw.repos[key]!.nextId = nextId
    await writeFile(storePath, JSON.stringify(raw), "utf8")
    return { store, repo, storePath }
  }

  it("counts an unreadable entry instead of reporting the survivors as the whole board", async () => {
    // id 2 becomes the STRING "2" — the one field normalizeIssue refuses.
    const { store, repo } = await seed({ id: "2" }, 3)
    const listed = await store.list(repo)
    expect(listed.issues).toHaveLength(1)
    // Without this, `exists: true` + a one-item list is indistinguishable from
    // a board that only ever had one story.
    expect(listed.skipped).toBe(1)
  })

  it("reports skipped: 0 when every entry parsed", async () => {
    const repo = await realpath(await makeRepo())
    const dir = await mkdtemp(join(tmpdir(), "kobe-issues-clean-"))
    cleanups.push(dir)
    const store = new IssuesStore(join(dir, "issues.json"))
    await store.mutate(repo, { type: "create", title: "ship the thing" })
    await expect(store.list(repo)).resolves.toMatchObject({ skipped: 0 })
  })

  it("allocates past the highest id on disk when nextId is corrupt", async () => {
    // nextId is the STRING "3": the old fallback was a flat `1`, which
    // `create` then handed out — colliding with issue #1 already in the file,
    // after which every id-keyed op hits whichever card `find` reaches first.
    const { store, repo } = await seed({}, "3")
    await expect(store.list(repo)).resolves.toMatchObject({ nextId: 3 })
    const created = await store.mutate(repo, { type: "create", title: "collision probe" })
    expect(created.issues[0]?.id).toBe(3)
    expect(new Set(created.issues.map((issue) => issue.id)).size).toBe(created.issues.length)
  })

  it("keeps an unreadable entry on disk across an unrelated mutation", async () => {
    // The warning used to document a recovery window one mutation wide: the
    // read counted issue "2" into `skipped`, then the next whole-file write
    // re-emitted only what it had parsed and the story was gone for good.
    const { store, repo, storePath } = await seed({ id: "2" }, 3)
    await store.mutate(repo, { type: "setStatus", id: 1, status: "done" })
    const onDisk = JSON.parse(await readFile(storePath, "utf8")) as {
      repos: Record<string, { issues: { id: unknown }[] }>
    }
    const ids = Object.values(onDisk.repos)[0]!.issues.map((issue) => issue.id)
    expect(ids).toContain("2")
    // …and the read still says so, rather than going quiet now that the write
    // "cleaned up".
    await expect(store.list(repo)).resolves.toMatchObject({ skipped: 1 })
  })

  it("refuses to write over a record whose `issues` is an object, and never calls it skipped: 0", async () => {
    const repo = await realpath(await makeRepo())
    const dir = await mkdtemp(join(tmpdir(), "kobe-issues-object-"))
    cleanups.push(dir)
    const storePath = join(dir, "issues.json")
    const store = new IssuesStore(storePath)
    await store.mutate(repo, { type: "create", title: "ship the thing" })
    await store.mutate(repo, { type: "create", title: "second story" })
    const raw = JSON.parse(await readFile(storePath, "utf8")) as {
      repos: Record<string, { issues: unknown }>
    }
    const key = Object.keys(raw.repos)[0]!
    const before = raw.repos[key]!.issues as { id: number }[]
    // A map keyed by id — the shape a hand-edit or an older writer leaves.
    raw.repos[key]!.issues = Object.fromEntries(before.map((issue) => [String(issue.id), issue]))
    await writeFile(storePath, JSON.stringify(raw), "utf8")

    // `skipped: 0` is the one value the field documents as "you have it all",
    // and the object branch used to report exactly that after dropping both.
    await expect(store.list(repo)).resolves.toMatchObject({ skipped: 2 })
    // The next create used to persist the emptiness. Now it refuses by name.
    await expect(store.mutate(repo, { type: "create", title: "would erase two" })).rejects.toThrow(
      "ISSUE_STORE_UNREADABLE",
    )
    const after = JSON.parse(await readFile(storePath, "utf8")) as { repos: Record<string, { issues: unknown }> }
    expect(after.repos[key]!.issues).toEqual(raw.repos[key]!.issues)
  })

  it("counts an unusable id toward the next allocation, so the fallback cannot reuse it", async () => {
    const { store, repo } = await seed({ id: "2" }, "nope")
    // Issue "2" is dropped from `issues`, but its id is still spoken for on
    // disk: deriving the fallback from the PARSED list alone would hand out 2.
    const created = await store.mutate(repo, { type: "create", title: "after the hole" })
    expect(created.issues[0]?.id).toBe(3)
  })
})
