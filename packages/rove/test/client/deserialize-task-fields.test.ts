/**
 * Decode-codec field guard for `deserializeTask` — the THIRD hand-written
 * allowlist a Task field has to survive, and the last one before the TUI.
 *
 * The other two: `test/orchestrator/store-codec-roundtrip.test.ts` closes the
 * disk side (`coerceTask`), `test/daemon/serialize-task-fields.test.ts`
 * closes the wire side (`serializeTask`). This closes the decode side, which
 * had no coverage — and it is the single funnel every task the TUI renders
 * passes through, so a field dropped here is invisible in the product even
 * though it persisted correctly AND arrived on the wire correctly.
 *
 * Six fields were being dropped when this was written: `command`,
 * `observedLanguage`, `quotaResume`, `linkedWorkItem`, `prompt`, `baseRef`. `command` was the load-bearing one — a task launched with
 * `add --command 'claude --dangerously-skip-permissions'` reached
 * `engineLaunchArgv` (`src/engine/engine-presets.ts`) with `command`
 * undefined, fell through its `if (!command)` guard, and launched the vendor
 * default instead. `quotaResume` meant `quotaResumeNote` could never render.
 *
 * Same class-closing technique as the other two: `DeepRequired<SerializedTask>`
 * forces the fixture to name every wire field at compile time, so a new
 * optional breaks the build here until it is listed, and the assertion then
 * goes red until `deserializeTask` carries it.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { describe, expect, it } from "vitest"
import { deserializeTask } from "../../src/client/remote-orchestrator-payloads.ts"

type DeepRequired<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends string | number | boolean
    ? NonNullable<T[K]>
    : DeepRequired<NonNullable<T[K]>>
}

/** Every field the wire can carry, each with a distinguishable value. */
/**
 * `origin` is excluded on purpose. It is the ONE field on a task that no
 * daemon ever produces and no store ever keeps: the client stamps it while
 * merging several machines' task lists (`machines/hub.ts`), so a round-trip
 * guard demanding it survive would be asserting the opposite of the design.
 */
const FULL: DeepRequired<Omit<SerializedTask, "origin">> = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  title: "decode fixture",
  repo: "/repo",
  branch: "fix/decode",
  worktreePath: "/repo/.worktrees/decode",
  kind: "task",
  scratch: true,
  noProject: true,
  routine: { automationId: "auto-1" },
  status: "in_review",
  pinned: true,
  archived: true,
  vendor: "claude",
  command: "claude --dangerously-skip-permissions",
  observedLanguage: "zh",
  modelEffort: "high",
  model: "opus",
  tier: "standard",
  groupId: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  prStatus: {
    provider: "github",
    lifecycle: "open",
    checkState: "passing",
    number: 42,
    url: "https://github.com/o/r/pull/42",
    title: "fix: decode",
    additions: 79,
    deletions: 16,
    baseRef: "main",
    reviewDecision: "APPROVED",
    mergeable: "MERGEABLE",
    lastCheckedAt: "2026-08-30T00:00:00.000Z",
    lastError: "none",
  },
  deletion: {
    phase: "queued",
    force: true,
    deleteBranch: true,
    requestedAt: "2026-08-30T00:00:00.000Z",
    error: "none",
  },
  quotaResume: {
    resumeAt: "2026-08-30T01:00:00.000Z",
    requestedAt: "2026-08-30T00:00:00.000Z",
  },
  linkedWorkItem: {
    provider: "github",
    type: "issue",
    number: 7,
    title: "linked",
    url: "https://github.com/o/r/issues/7",
  },
  dispatcher: { taskId: "01ARZ3NDEKTSV4RRFFQ69G5FAX", tabId: "tab-1" },
  parentTaskId: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
  sharesWorkspaceOf: "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
  cwdSubpath: "packages/app",
  ptyAlias: { taskId: "01ARZ3NDEKTSV4RRFFQ69G5FB0", tabId: "tab-2" },
  requireReport: true,
  prompt: "the full task brief — never truncated on the way off the wire",
  baseRef: "release/2.x",
  worktreeName: "probe-1",
  workspace: { backend: "cow-clone", ref: "01ARZ3NDEKTSV4RRFFQ69G5FB5" },
  extraRepos: [
    {
      name: "api",
      repo: "/other/api",
      branch: "fix/wire",
      worktreePath: "/other/.worktrees/api-1",
      baseRef: "release/1.x",
      prStatus: {
        provider: "github",
        lifecycle: "open",
        checkState: "failing",
        number: 43,
        url: "https://github.com/o/api/pull/43",
        title: "fix: api side",
        additions: 79,
        deletions: 16,
        baseRef: "release/1.x",
        reviewDecision: "APPROVED",
        mergeable: "MERGEABLE",
        lastCheckedAt: "2026-08-27T00:00:00.000Z",
        lastError: "transient fetch error",
      },
    },
  ],
  sessionPrs: [
    {
      url: "https://github.com/o/other/pull/44",
      addedAt: "2026-08-27T00:00:00.000Z",
      status: {
        provider: "github",
        lifecycle: "merged",
        checkState: "passing",
        number: 44,
        url: "https://github.com/o/other/pull/44",
        title: "feat: session side",
        additions: 5,
        deletions: 2,
        baseRef: "main",
        reviewDecision: "APPROVED",
        mergeable: "MERGEABLE",
        lastCheckedAt: "2026-08-27T00:00:00.000Z",
        lastError: "transient fetch error",
      },
    },
  ],
  report: {
    branch: "fix/wire",
    pr: 921,
    summary: "worker's own account of what it delivered",
    at: "2026-08-27T00:00:00.000Z",
  },
  repoId: "github.com/o/r",
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
}

describe("deserializeTask", () => {
  it("takes every wire field off the wire", () => {
    const task = deserializeTask(FULL as SerializedTask) as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(FULL)) {
      expect(task[key], `deserializeTask dropped "${key}"`).toEqual(value)
    }
  })

  it("carries the custom launch command, which decided which engine binary ran", () => {
    // The regression this file was written for: persisted fine, arrived on the
    // wire fine, dropped here — so `engineLaunchArgv` saw no command and
    // launched the vendor default instead of what `add --command` was given.
    expect(deserializeTask({ ...FULL, command: "codex --yolo" } as SerializedTask).command).toBe("codex --yolo")
    expect(deserializeTask({ ...FULL, command: undefined } as SerializedTask).command).toBeUndefined()
  })
})
