/**
 * Disk-codec field guard for `normalizeIssue` — the hand-written allowlist an
 * Issue field has to survive.
 *
 * `normalizeIssue` rebuilds every field by name, so a new optional on `Issue`
 * writes to issues.json, reads back as `undefined`, and nothing fails: the
 * type says the field exists, the store silently drops it, and the first
 * report is a user wondering why a value they set vanished.
 *
 * Same technique as `test/daemon/serialize-task-fields.test.ts`, which closes
 * the same hole on the wire codec: `DeepRequired` forces the fixture to name
 * every field at compile time, so a new optional breaks the BUILD here until
 * it is listed, and the assertion then goes red until `normalizeIssue`
 * carries it.
 */

import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type Issue, IssuesStore } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { afterEach, expect, it } from "vitest"

type DeepRequired<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends string | number | boolean
    ? NonNullable<T[K]>
    : DeepRequired<NonNullable<T[K]>>
}

/** Every field an Issue can carry, each with a distinguishable value. */
const FULL: DeepRequired<Issue> = {
  id: 7,
  title: "disk fixture",
  status: "hold",
  created: "2026-07-15",
  body: "the body text",
  taskId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
}

const cleanups: string[] = []

afterEach(async () => {
  while (cleanups.length) await rm(cleanups.pop()!, { recursive: true, force: true })
})

/** A git repo plus an issues.json already holding `issues`, keyed the way the
 *  store keys it (git common dir), so `list` reads a file it did not write. */
async function seedStore(issues: unknown[]): Promise<{ repo: string; store: IssuesStore }> {
  const parent = await mkdtemp(join(tmpdir(), "kobe-issue-fields-"))
  cleanups.push(parent)
  const repo = join(parent, "repo")
  await mkdir(repo)
  execFileSync("git", ["init", "--quiet"], { cwd: repo })

  const storePath = join(parent, "home", ".kobe", "issues.json")
  await mkdir(join(parent, "home", ".kobe"), { recursive: true })
  await writeFile(
    storePath,
    JSON.stringify({
      version: 1,
      repos: {
        [await realpath(join(repo, ".git"))]: { repoRoot: await realpath(repo), nextId: 99, issues },
      },
    }),
    "utf8",
  )
  return { repo, store: new IssuesStore(storePath) }
}

it("reads back every field an Issue declares", async () => {
  const { repo, store } = await seedStore([FULL])
  const read = await store.list(repo)
  expect(read.issues).toEqual([FULL])
})

it("keeps the known fields of a record carrying an unknown key, and defaults the absent ones", async () => {
  const { repo, store } = await seedStore([{ id: 3, title: "from a newer Rove", futureField: { nested: true } }])
  const read = await store.list(repo)
  // Absent `body`/`created` read back as "" and `status` as "open" — the
  // fallbacks are the contract, not incidental.
  expect(read.issues).toEqual([{ id: 3, title: "from a newer Rove", status: "open", created: "", body: "" }])
})
