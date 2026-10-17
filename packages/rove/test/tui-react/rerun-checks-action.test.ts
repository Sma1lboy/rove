/**
 * "Re-run failed checks" outcome → toast tone. The daemon is injected; the
 * `gh` side is `test/daemon/pr-rerun-checks.test.ts`.
 */

import { describe, expect, test } from "vitest"
import type { RerunFailedChecksResult } from "../../src/client/remote-orchestrator-writes"
import { rerunChecksAction } from "../../src/tui-react/workspace/rerun-checks-action"

async function run(result: RerunFailedChecksResult | Error) {
  const toasts: string[] = []
  await rerunChecksAction(
    {
      orchestrator: {
        rerunFailedChecks: async () => {
          if (result instanceof Error) throw result
          return result
        },
      },
      notifyInfo: (m) => void toasts.push(`info ${m}`),
      notifyNeedsInput: (m) => void toasts.push(`attention ${m}`),
      notifyError: (m) => void toasts.push(`error ${m}`),
      t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    },
    "t1",
  )
  return toasts
}

describe("rerunChecksAction", () => {
  test.each<[string, RerunFailedChecksResult | Error, string]>([
    [
      "a restarted run wins over a second run gh refused",
      { rerunRuns: 1, external: 0, refused: "x" },
      "info tasks.rerun.started",
    ],
    ["checks outside Actions need the user elsewhere", { rerunRuns: 0, external: 2 }, "attention tasks.rerun.external"],
    ["nothing red any more", { rerunRuns: 0, external: 0 }, "info tasks.rerun.none"],
    [
      "gh's refusal is quoted, first line only",
      { rerunRuns: 0, external: 0, refused: "run 9 cannot be rerun; it is in progress\nhint: wait" },
      'error tasks.rerun.refused {"detail":"run 9 cannot be rerun; it is in progress"}',
    ],
    [
      "an unreadable rollup names gh",
      { rerunRuns: 0, external: 0, unavailable: { reason: "gh_failed", detail: "not logged in" } },
      'error files.toast.ciChecksUnavailable {"detail":"not logged in"}',
    ],
    [
      "a dead daemon is an error, not silence",
      new Error("daemon gone"),
      'error tasks.rerun.refused {"detail":"daemon gone"}',
    ],
  ])("%s", async (_name, result, toast) => {
    expect(await run(result)).toEqual([toast])
  })
})
