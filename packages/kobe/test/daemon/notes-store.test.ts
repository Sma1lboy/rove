/**
 * NotesStore tests — the durable half of field notes. Pins: newest-first
 * append ordering, per-repo id allocation and the id backfill for stores
 * written before ids existed, removal by id, retention eviction at the cap,
 * and the git common-dir key so a worktree and its source checkout share one
 * record.
 */

import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type FieldNote, NOTES_RETENTION_CAP, NotesStore } from "@sma1lboy/kobe-daemon/daemon/notes-store"
import { afterEach, describe, expect, it } from "vitest"

const cleanups: string[] = []

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "kobe-notes-store-"))
  cleanups.push(repo)
  execFileSync("git", ["init", "--quiet"], { cwd: repo })
  await writeFile(join(repo, "README.md"), "fixture\n", "utf8")
  execFileSync("git", ["add", "."], { cwd: repo })
  execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "--quiet", "-m", "fixture"],
    { cwd: repo },
  )
  return repo
}

function note(text: string): Omit<FieldNote, "id"> {
  return { at: "2026-08-08T00:00:00.000Z", text, taskId: "t1", author: "worker" }
}

afterEach(async () => {
  while (cleanups.length) await rm(cleanups.pop()!, { recursive: true, force: true })
})

describe("NotesStore", () => {
  it("returns nothing for a repo that never filed a note", async () => {
    const repo = await makeRepo()
    const store = new NotesStore(join(repo, "home", ".kobe", "notes.json"))
    expect(await store.list(repo)).toEqual([])
  })

  it("appends newest-first so recall reads as a recency-ordered list", async () => {
    const repo = await makeRepo()
    const store = new NotesStore(join(repo, "home", ".kobe", "notes.json"))
    await store.append(repo, note("first"))
    await store.append(repo, note("second"))
    expect((await store.list(repo)).map((n) => n.text)).toEqual(["second", "first"])
  })

  it("evicts past the retention cap instead of growing without bound", async () => {
    const repo = await makeRepo()
    const store = new NotesStore(join(repo, "home", ".kobe", "notes.json"))
    for (let i = 0; i < NOTES_RETENTION_CAP + 5; i++) await store.append(repo, note(`n${i}`))
    const notes = await store.list(repo)
    expect(notes).toHaveLength(NOTES_RETENTION_CAP)
    expect(notes[0].text).toBe(`n${NOTES_RETENTION_CAP + 4}`)
    expect(notes.some((n) => n.text === "n0")).toBe(false)
  })

  it("shares one record between a repo and its worktrees (git common-dir key)", async () => {
    const repo = await makeRepo()
    const parent = await mkdtemp(join(tmpdir(), "kobe-notes-wt-"))
    cleanups.push(parent)
    const worktree = join(parent, "task")
    execFileSync("git", ["worktree", "add", "--quiet", worktree, "-b", "task"], { cwd: repo })

    const store = new NotesStore(join(parent, "home", ".kobe", "notes.json"))
    await store.append(worktree, note("filed from the worktree"))
    expect((await store.list(repo)).map((n) => n.text)).toEqual(["filed from the worktree"])
  })

  // Deletion is the correction path. Without it a note whose fact stopped
  // being true keeps riding into every fresh session on the repo, and the
  // only fix was hand-editing the daemon's JSON.
  it("removes one note by id and leaves its siblings alone", async () => {
    const repo = await makeRepo()
    const store = new NotesStore(join(repo, "home", ".kobe", "notes.json"))
    await store.append(repo, note("stale"))
    const keep = await store.append(repo, note("still true"))
    const stale = (await store.list(repo)).find((n) => n.text === "stale")

    expect(await store.remove(repo, stale!.id)).toBe(true)
    expect((await store.list(repo)).map((n) => n.text)).toEqual(["still true"])
    // The survivor keeps the id it was allocated — a delete must never
    // renumber, or a caller holding an id would delete the wrong note next.
    expect((await store.list(repo))[0].id).toBe(keep.id)
  })

  it("answers false for an id nothing holds rather than throwing", async () => {
    // Not an error: the retention ring may already have evicted the note a
    // sweeper is asking about, and "gone now" is the outcome it wanted.
    const repo = await makeRepo()
    const store = new NotesStore(join(repo, "home", ".kobe", "notes.json"))
    await store.append(repo, note("only"))
    expect(await store.remove(repo, 999)).toBe(false)
    expect(await store.list(repo)).toHaveLength(1)
  })

  it("allocates ids that survive eviction instead of reusing a live one", async () => {
    // Deriving the next id from the array LENGTH would reissue ids the newest
    // notes still hold once the ring starts dropping the tail — and a delete
    // by such an id would hit two notes.
    const repo = await makeRepo()
    const store = new NotesStore(join(repo, "home", ".kobe", "notes.json"))
    for (let i = 0; i < NOTES_RETENTION_CAP + 5; i++) await store.append(repo, note(`n${i}`))
    const ids = (await store.list(repo)).map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("backfills ids for a store written before the field existed", async () => {
    // The launch-path reader parses this file directly, so legacy notes must
    // keep being listed — and every one must come back addressable.
    const repo = await makeRepo()
    const storePath = join(repo, "home", ".kobe", "notes.json")
    const store = new NotesStore(storePath)
    await store.append(repo, note("seed"))
    const raw = JSON.parse(await readFile(storePath, "utf8"))
    for (const record of Object.values(raw.repos) as Array<{ notes: Record<string, unknown>[] }>) {
      record.notes.push({ at: "2026-08-01T00:00:00.000Z", text: "legacy", taskId: "t0", author: "old" })
      for (const n of record.notes) Reflect.deleteProperty(n, "id")
    }
    await writeFile(storePath, JSON.stringify(raw), "utf8")

    const notes = await store.list(repo)
    expect(notes.map((n) => n.text)).toEqual(["seed", "legacy"])
    expect(notes.every((n) => n.id > 0)).toBe(true)
    // Deterministic: the same file yields the same ids on every read, so an
    // id read now is still the right one to delete a moment later.
    expect((await store.list(repo)).map((n) => n.id)).toEqual(notes.map((n) => n.id))
    expect(await store.remove(repo, notes[1].id)).toBe(true)
    expect((await store.list(repo)).map((n) => n.text)).toEqual(["seed"])
  })

  it("rejects a plain directory rather than silently writing a bogus record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kobe-notes-plain-"))
    cleanups.push(dir)
    const store = new NotesStore(join(dir, "home", ".kobe", "notes.json"))
    await expect(store.append(dir, note("x"))).rejects.toThrow()
  })
})
