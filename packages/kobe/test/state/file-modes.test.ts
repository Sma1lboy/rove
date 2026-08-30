/**
 * `state.json` and `tasks.json` are user-scoped records — engine command lines
 * (where an `--api-key=…` gets pasted), saved repo paths, task titles. None of
 * that is another local user's business, so both land 0600.
 *
 * Asserts the REAL mode via `statSync`, not the options a write was called
 * with: only the on-disk bits prove the fix survived the write path.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { patchStateFile } from "../../src/state/store.ts"

let tmpHome: string
let originalHome: string | undefined

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-file-modes-"))
  originalHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = tmpHome
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.KOBE_HOME_DIR
  else process.env.KOBE_HOME_DIR = originalHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

/** Permission bits only — `statSync().mode` carries the file type too. */
function mode(file: string): number {
  return fs.statSync(file).mode & 0o777
}

describe("user-scoped state files are owner-only", () => {
  test("state.json is 0600", () => {
    // The value that motivates it: a custom engine command is a user-authored
    // shell line, and a shell line is where a key ends up.
    patchStateFile({ "engineCommand.custom": "claude --api-key=sk-live-123" })
    expect(mode(path.join(tmpHome, ".config", "rove", "state.json"))).toBe(0o600)
  })

  test("tasks.json is 0600", async () => {
    const store = new TaskIndexStore({ homeDir: tmpHome })
    await store.load()
    await store.create({
      title: "alpha",
      repo: "/repo",
      branch: "kobe/alpha",
      worktreePath: "/repo/.kobe/worktrees/alpha",
      kind: "task",
      status: "backlog",
    })
    expect(mode(path.join(tmpHome, ".rove", "tasks.json"))).toBe(0o600)
  })
})
