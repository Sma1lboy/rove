/**
 * Live auto-title poller (KOB). Drives the pass logic against a REAL
 * Orchestrator + on-disk store, with an injected title-deriver so no real
 * worktree / transcript is needed — the seam under test is the placeholder
 * filter, the re-check-before-rename guard, and per-task error isolation.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  pinnedConversation,
  runAutoTitlePass as runPassWithVendor,
} from "@sma1lboy/rove-daemon/daemon/auto-title-poller"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { Orchestrator, PLACEHOLDER_TASK_TITLE } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

let tmpRoot: string
let store: TaskIndexStore
let orch: Orchestrator

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rove-autotitle-"))
  store = new TaskIndexStore({ homeDir: path.join(tmpRoot, "home") })
  await store.load()
  orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
})

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    // ignored
  }
})

/** Create a task, then stamp a worktreePath on it (createTask leaves it empty). */
async function makeTask(opts: { title?: string; worktree?: string; groupId?: string }) {
  const task = await orch.createTask({ repo: "/repo", title: opts.title, groupId: opts.groupId })
  if (opts.worktree !== undefined) await store.update(task.id, { worktreePath: opts.worktree })
  return task.id
}

/** The pass takes its placeholder and default vendor from the runtime adapter
 *  in production; neither is what these cases are about. */
const runAutoTitlePass = (
  ...args: [Parameters<typeof runPassWithVendor>[0], Parameters<typeof runPassWithVendor>[1]]
): ReturnType<typeof runPassWithVendor> => runPassWithVendor(args[0], args[1], "(new task)", "claude")

describe("runAutoTitlePass", () => {
  test("renames only placeholder tasks that have a worktree", async () => {
    const placeholderWithWorktree = await makeTask({ worktree: "/wt/a" })
    const alreadyNamed = await makeTask({ title: "Fix login 500", worktree: "/wt/b" })
    const placeholderNoWorktree = await makeTask({ worktree: undefined })

    const renamed = await runAutoTitlePass(orch, async (worktree) => `title-for-${worktree}`)

    expect(renamed.map((r) => r.id)).toEqual([placeholderWithWorktree])
    expect(renamed[0]?.title).toBe("title-for-/wt/a")
    expect(orch.getTask(placeholderWithWorktree)?.title).toBe("title-for-/wt/a")
    expect(orch.getTask(alreadyNamed)?.title).toBe("Fix login 500")
    expect(orch.getTask(placeholderNoWorktree)?.title).toBe(PLACEHOLDER_TASK_TITLE)
  })

  test("a failing task does not block the others", async () => {
    const boom = await makeTask({ worktree: "/wt/boom" })
    const ok = await makeTask({ worktree: "/wt/ok" })

    const renamed = await runAutoTitlePass(orch, async (worktree) => {
      if (worktree === "/wt/boom") throw new Error("disk read failed")
      return `title-for-${worktree}`
    })

    expect(renamed.map((r) => r.id)).toEqual([ok])
    expect(orch.getTask(boom)?.title).toBe(PLACEHOLDER_TASK_TITLE)
    expect(orch.getTask(ok)?.title).toBe("title-for-/wt/ok")
  })

  test("does not overwrite a manual rename that lands during the disk read", async () => {
    const id = await makeTask({ worktree: "/wt/a" })

    // Simulate the user renaming mid-read: the deriver (standing in for the
    // slow transcript read) renames the task before returning its own title.
    const renamed = await runAutoTitlePass(orch, async () => {
      await orch.setTitle(id, "User chose this")
      return "derived-title"
    })

    expect(renamed).toEqual([])
    expect(orch.getTask(id)?.title).toBe("User chose this")
  })

  test("appends #i/N to fan-out siblings whose derived titles would collide", async () => {
    // Fan-out siblings share their first prompt, so the deriver returns the
    // SAME title for each — the group ordinal is what keeps them tellable
    // apart in the sidebar.
    const a = await makeTask({ worktree: "/wt/a", groupId: "g1" })
    const b = await makeTask({ worktree: "/wt/b", groupId: "g1" })
    const solo = await makeTask({ worktree: "/wt/solo" })

    await runAutoTitlePass(orch, async () => "same prompt title")

    expect(orch.getTask(a)?.title).toBe("same prompt title #1/2")
    expect(orch.getTask(b)?.title).toBe("same prompt title #2/2")
    expect(orch.getTask(solo)?.title).toBe("same prompt title")
  })
})

describe("runAutoTitlePass on a shared directory", () => {
  const byId = async (_vendor: string, sessionId: string) => `own-${sessionId}`

  test("a second conversation in a shared directory never takes its sibling's title from the directory scan", async () => {
    const first = await makeTask({ title: "first conversation", worktree: "/repo" })
    const second = await makeTask({ worktree: "/repo" })

    const renamed = await runPassWithVendor(orch, async () => "first conversation", "(new task)", "claude", {
      conversationOf: () => undefined,
      deriveById: byId,
    })

    expect(renamed).toEqual([])
    expect(orch.getTask(second)?.title).toBe(PLACEHOLDER_TASK_TITLE)
    expect(orch.getTask(first)?.title).toBe("first conversation")
  })

  test("it is named from its own pinned session instead", async () => {
    await makeTask({ title: "first conversation", worktree: "/repo" })
    const second = await makeTask({ worktree: "/repo" })
    const scans: string[] = []

    await runPassWithVendor(
      orch,
      async (worktree) => {
        scans.push(worktree)
        return "first conversation"
      },
      "(new task)",
      "claude",
      { conversationOf: (id) => (id === second ? { sessionId: "s-2", vendor: "omp" } : undefined), deriveById: byId },
    )

    expect(orch.getTask(second)?.title).toBe("own-s-2")
    expect(scans).toEqual([])
  })

  test("a task alone in its directory still uses the directory scan", async () => {
    const solo = await makeTask({ worktree: "/wt/solo" })
    await runPassWithVendor(orch, async () => "scanned", "(new task)", "claude", {
      conversationOf: () => ({ sessionId: "unused" }),
      deriveById: byId,
    })
    expect(orch.getTask(solo)?.title).toBe("scanned")
  })
})

describe("runAutoTitlePass on a scratch conversation", () => {
  test("is named from its own session, never the directory scan, and stays scratch", async () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "scratch-"))
    const scratch = await orch.openDirectoryTask({ dir, scratch: true })
    const scans: string[] = []
    const deriveScan = async (worktree: string) => {
      scans.push(worktree)
      return "someone else's conversation"
    }

    await runPassWithVendor(orch, deriveScan, "(new task)", "claude", {
      conversationOf: () => undefined,
      deriveById: async () => "unused",
    })
    expect(orch.getTask(scratch.id)?.title).toBe("")

    await runPassWithVendor(orch, deriveScan, "(new task)", "claude", {
      conversationOf: () => ({ sessionId: "s-1" }),
      deriveById: async (_vendor, sessionId) => `own-${sessionId}`,
    })
    expect(orch.getTask(scratch.id)).toMatchObject({ title: "own-s-1", scratch: true })
    expect(scans).toEqual([])
  })
})

describe("pinnedConversation", () => {
  test("reads the first engine tab's pinned session and vendor; anything else is none", () => {
    expect(
      pinnedConversation({
        tabs: [
          { kind: "command", id: "tab-1", sessionId: "not-an-engine" },
          { kind: "engine", id: "tab-2", sessionId: "abc", vendor: "omp" },
        ],
      }),
    ).toEqual({ sessionId: "abc", vendor: "omp" })
    expect(pinnedConversation({ tabs: [{ kind: "engine", id: "tab-1", sessionId: null }] })).toBeUndefined()
    expect(pinnedConversation(null)).toBeUndefined()
  })
})
