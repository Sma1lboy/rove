/**
 * The React-free core of the Fix-failing-checks action (`fixCIAction`): the
 * empty-result toast, both stale-continuation identity guards, and the park
 * slot for a row that is not the active task. Daemon + prompt IO are injected,
 * so these pin the control flow, not the prompt content (`ci-prompt.test.ts`
 * owns that).
 */

import { describe, expect, test } from "vitest"
import { fixCIAction, requestFixCI, takeFixCI } from "../../src/tui-react/workspace/use-fix-ci"

const CHECK = { jobName: "render-track", conclusion: "FAILURE", url: "u", tail: "boom" }

function deps(over: Partial<Parameters<typeof fixCIAction>[0]> = {}) {
  const sent: string[] = []
  const errors: string[] = []
  const send = (text: string) => void sent.push(text)
  const base = {
    worktree: "/wt/a",
    sendToEngineFn: { current: send },
    selectedWorktreeRef: { current: "/wt/a" },
    notifyError: (message: string) => void errors.push(message),
    t: (key: string) => key,
    getTask: () => ({ branch: "feat/x", prNumber: 7 }),
    fetchChecks: async () => ({ checks: [CHECK], totalFailing: 1 }),
    build: async () => "CI PROMPT",
    ...over,
  }
  return { base, sent, errors }
}

describe("fixCIAction", () => {
  test("sends the built prompt into the live session", async () => {
    const { base, sent, errors } = deps()
    await fixCIAction(base)("t1")
    expect(sent).toEqual(["CI PROMPT"])
    expect(errors).toEqual([])
  })

  test("passes the row's branch and PR number to the prompt builder", async () => {
    const seen: unknown[] = []
    const { base } = deps({
      build: async (_wt, state) => {
        seen.push(state)
        return "P"
      },
    })
    await fixCIAction(base)("t1")
    expect(seen).toEqual([{ branch: "feat/x", prNumber: 7, checks: [CHECK], totalFailing: 1 }])
  })

  test("distinguishes an unreadable gh from checks that are no longer red", async () => {
    // Both arrive as `checks: []`. Only one of them means the user can stop
    // worrying about the red badge they clicked on.
    const { base, sent, errors } = deps({
      fetchChecks: async () => ({
        checks: [],
        totalFailing: 0,
        unavailable: {
          reason: "gh_failed",
          detail: "gh: To get started with GitHub CLI, please run: gh auth login\nhint: more",
        },
      }),
      t: (key: string, params?: Record<string, string | number>) => `${key}:${params?.detail ?? ""}`,
    })
    await fixCIAction(base)("t1")
    expect(sent).toEqual([])
    expect(errors).toEqual([
      "files.toast.ciChecksUnavailable:gh: To get started with GitHub CLI, please run: gh auth login",
    ])
  })

  test("toasts instead of sending when the daemon reports no failing checks", async () => {
    const { base, sent, errors } = deps({ fetchChecks: async () => ({ checks: [], totalFailing: 0 }) })
    await fixCIAction(base)("t1")
    expect(sent).toEqual([])
    expect(errors).toEqual(["files.toast.ciNoFailingChecks"])
  })

  test("drops a stale continuation when the selected worktree changed mid-fetch", async () => {
    const { base, sent } = deps()
    const selectedWorktreeRef = { current: "/wt/a" }
    await fixCIAction({
      ...base,
      selectedWorktreeRef,
      fetchChecks: async () => {
        selectedWorktreeRef.current = "/wt/OTHER"
        return { checks: [CHECK], totalFailing: 1 }
      },
    })("t1")
    expect(sent).toEqual([])
  })

  test("drops a stale continuation when TerminalTabs re-handed its send closure", async () => {
    const { base, sent } = deps()
    const sendToEngineFn = { current: base.sendToEngineFn.current }
    await fixCIAction({
      ...base,
      sendToEngineFn,
      fetchChecks: async () => {
        sendToEngineFn.current = () => {}
        return { checks: [CHECK], totalFailing: 1 }
      },
    })("t1")
    expect(sent).toEqual([])
  })

  test("does nothing without an engine, a worktree, or a task", async () => {
    for (const over of [{ sendToEngineFn: { current: null } }, { worktree: null }, { getTask: () => null }] as Partial<
      Parameters<typeof fixCIAction>[0]
    >[]) {
      const { base, sent, errors } = deps(over)
      await fixCIAction(base)("t1")
      expect(sent).toEqual([])
      expect(errors).toEqual([])
    }
  })
})

describe("the park slot", () => {
  test("only the parked task can claim it, and only once", () => {
    requestFixCI("t1")
    expect(takeFixCI("other")).toBeNull()
    expect(takeFixCI("t1")).toBe("t1")
    expect(takeFixCI("t1")).toBeNull()
  })

  test("a second request retargets rather than queueing", () => {
    requestFixCI("t1")
    requestFixCI("t2")
    expect(takeFixCI("t1")).toBeNull()
    expect(takeFixCI("t2")).toBe("t2")
  })

  test("a null task id never claims", () => {
    requestFixCI("t1")
    expect(takeFixCI(null)).toBeNull()
    expect(takeFixCI("t1")).toBe("t1")
  })
})
