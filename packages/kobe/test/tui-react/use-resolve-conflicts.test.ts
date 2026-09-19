/**
 * The React-free core of Resolve-conflicts-with-agent (`resolveConflictsAction`):
 * which sync outcome becomes a prompt in the engine and which stays a toast,
 * both stale-continuation identity guards, and the park slot for a row that is
 * not the active task. Daemon + prompt IO are injected, so these pin the
 * control flow, not the prompt content (`conflict-prompt.test.ts` owns that).
 */

import { describe, expect, test } from "vitest"
import { SYNC_CONFLICT, SYNC_DIRTY } from "../../src/orchestrator/sync-base"
import {
  requestResolveConflicts,
  resolveConflictsAction,
  splitConflictFiles,
  takeResolveConflicts,
} from "../../src/tui-react/workspace/use-resolve-conflicts"

const conflict = async (): Promise<never> => {
  throw new Error(`${SYNC_CONFLICT}: src/a.ts, src/b.ts`)
}

function deps(over: Partial<Parameters<typeof resolveConflictsAction>[0]> = {}) {
  const sent: string[] = []
  const info: string[] = []
  const attention: string[] = []
  const errors: string[] = []
  const send = (text: string) => void sent.push(text)
  const base = {
    worktree: "/wt/a",
    sendToEngineFn: { current: send },
    selectedWorktreeRef: { current: "/wt/a" },
    notifyInfo: (m: string) => void info.push(m),
    notifyNeedsInput: (m: string) => void attention.push(m),
    notifyError: (m: string) => void errors.push(m),
    t: (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    getTask: () => ({ branch: "feat/x", baseRef: "origin/main" }),
    syncBase: conflict,
    build: async () => "CONFLICT PROMPT",
    ...over,
  }
  return { base, sent, info, attention, errors }
}

describe("resolveConflictsAction", () => {
  test("a conflict becomes the prompt in the live session, and a toast says so", async () => {
    const { base, sent, info, attention, errors } = deps()
    await resolveConflictsAction(base)("t1")
    expect(sent).toEqual(["CONFLICT PROMPT"])
    expect(info).toEqual(['tasks.conflicts.handedOff {"count":2}'])
    expect(attention).toEqual([])
    expect(errors).toEqual([])
  })

  test("passes the row's branch, its base, and the daemon's file list to the prompt builder", async () => {
    const seen: unknown[] = []
    const { base } = deps({
      build: async (_wt, state) => {
        seen.push(state)
        return "P"
      },
    })
    await resolveConflictsAction(base)("t1")
    expect(seen).toEqual([{ branch: "feat/x", baseRef: "origin/main", files: ["src/a.ts", "src/b.ts"] }])
  })

  test("a task with no recorded base still gets a prompt that names one", async () => {
    const seen: { baseRef: string }[] = []
    const { base } = deps({
      getTask: () => ({ branch: "feat/x" }),
      build: async (_wt, state) => {
        seen.push(state)
        return "P"
      },
    })
    await resolveConflictsAction(base)("t1")
    expect(seen[0]?.baseRef).toBe("the base branch")
  })

  test("a clean merge is the sync toast, and nothing reaches the engine", async () => {
    const { base, sent, info } = deps({ syncBase: async () => ({ baseRef: "main", alreadyCurrent: false }) })
    await resolveConflictsAction(base)("t1")
    expect(sent).toEqual([])
    expect(info).toEqual(['tasks.sync.done {"base":"main"}'])
  })

  test("an already-current worktree says so instead of pasting an empty conflict list", async () => {
    const { base, sent, info } = deps({ syncBase: async () => ({ baseRef: "main", alreadyCurrent: true }) })
    await resolveConflictsAction(base)("t1")
    expect(sent).toEqual([])
    expect(info).toEqual(['tasks.sync.alreadyCurrent {"base":"main"}'])
  })

  test("a dirty worktree is attention, not a prompt — the engine cannot commit for the user", async () => {
    const { base, sent, attention, errors } = deps({
      syncBase: async () => {
        throw new Error(`${SYNC_DIRTY}: new.txt`)
      },
    })
    await resolveConflictsAction(base)("t1")
    expect(sent).toEqual([])
    expect(attention).toEqual(['tasks.sync.dirty {"files":"new.txt"}'])
    expect(errors).toEqual([])
  })

  test("a marker-less failure is an error toast, never a prompt", async () => {
    const { base, sent, errors } = deps({
      syncBase: async () => {
        throw new Error("git merge origin/main failed — hook refused")
      },
    })
    await resolveConflictsAction(base)("t1")
    expect(sent).toEqual([])
    expect(errors).toEqual(['tasks.sync.failed {"error":"git merge origin/main failed — hook refused"}'])
  })

  test("drops a stale continuation when the selected worktree changed mid-merge", async () => {
    const { base, sent, info } = deps()
    const selectedWorktreeRef = { current: "/wt/a" }
    await resolveConflictsAction({
      ...base,
      selectedWorktreeRef,
      syncBase: async () => {
        selectedWorktreeRef.current = "/wt/OTHER"
        return conflict()
      },
    })("t1")
    expect(sent).toEqual([])
    expect(info).toEqual([])
  })

  test("drops a stale continuation when TerminalTabs re-handed its send closure", async () => {
    const { base, sent } = deps()
    const sendToEngineFn = { current: base.sendToEngineFn.current }
    await resolveConflictsAction({
      ...base,
      sendToEngineFn,
      syncBase: async () => {
        sendToEngineFn.current = () => {}
        return conflict()
      },
    })("t1")
    expect(sent).toEqual([])
  })

  test("does nothing without an engine, a worktree, or a task", async () => {
    for (const over of [{ sendToEngineFn: { current: null } }, { worktree: null }, { getTask: () => null }] as Partial<
      Parameters<typeof resolveConflictsAction>[0]
    >[]) {
      const { base, sent, info, errors } = deps(over)
      await resolveConflictsAction(base)("t1")
      expect(sent).toEqual([])
      expect(info).toEqual([])
      expect(errors).toEqual([])
    }
  })
})

describe("splitConflictFiles", () => {
  test("splits the daemon's comma list and drops blanks", () => {
    expect(splitConflictFiles("src/a.ts, src/b.ts")).toEqual(["src/a.ts", "src/b.ts"])
    expect(splitConflictFiles("?")).toEqual(["?"])
    expect(splitConflictFiles("")).toEqual([])
  })
})

describe("the park slot", () => {
  test("only the parked task can claim it, and only once", () => {
    requestResolveConflicts("t1")
    expect(takeResolveConflicts("other")).toBeNull()
    expect(takeResolveConflicts("t1")).toBe("t1")
    expect(takeResolveConflicts("t1")).toBeNull()
  })

  test("a second request retargets rather than queueing", () => {
    requestResolveConflicts("t1")
    requestResolveConflicts("t2")
    expect(takeResolveConflicts("t1")).toBeNull()
    expect(takeResolveConflicts("t2")).toBe("t2")
  })

  test("a null task id never claims", () => {
    requestResolveConflicts("t1")
    expect(takeResolveConflicts(null)).toBeNull()
    expect(takeResolveConflicts("t1")).toBe("t1")
  })
})
