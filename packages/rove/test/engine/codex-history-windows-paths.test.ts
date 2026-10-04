import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, it } from "vitest"
import {
  type HistoryDeps,
  findLatestRolloutForWorktree,
  listSessionIdsForWorktree,
} from "../../src/engine/codex-local/session-files"

it("finds the same Windows conversation through Git and native cwd spellings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rove-resume-path-"))
  const dir = path.join(root, "2026", "09", "06")
  await mkdir(dir, { recursive: true })
  const id = "aaaaaaaa-1111-2222-3333-444444444444"
  const file = path.join(dir, `rollout-2026-09-06T18-37-00-${id}.jsonl`)
  await writeFile(file, JSON.stringify({ type: "session_meta", payload: { cwd: "C:\\Users\\jackson\\repo" } }))
  const deps: HistoryDeps = {
    sessionsDir: () => root,
    readdir,
    readFile: (name) => readFile(name, "utf8"),
    stat,
  }
  expect(await listSessionIdsForWorktree("C:/Users/jackson/repo", deps)).toEqual([id])
  expect(await findLatestRolloutForWorktree("C:/Users/jackson/repo", deps)).toMatchObject({ path: file })
  expect(await listSessionIdsForWorktree("C:/Users/jackson/other", deps)).toEqual([])
})
