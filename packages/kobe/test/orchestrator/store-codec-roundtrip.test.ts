/**
 * Schema round-trip guard for the tasks.json codec (issue #57).
 *
 * `coerceTask` is a hand-written coercer: the WRITE path picks up a new Task
 * field automatically (object spread), but the READ path needs a hand-written
 * coerce line — and forgetting it is completely silent (optional fields make
 * the type system happy, and the field just vanishes on the next daemon
 * restart). That has happened seven times: command, position, modelEffort,
 * groupId, quotaResume, linkedWorkItem, dispatcher — and now
 * `deletion.deleteBranch`.
 *
 * This test closes the class, not the instance. `DeepRequired<Task>` forces
 * the fixture to carry EVERY field, nested optionals included, at compile
 * time — so adding an eighth optional field to Task (or its sub-records)
 * breaks the build here until the fixture names it, and the round-trip
 * assertion then goes red until `coerceTask` preserves it. No hand-maintained
 * field list to forget.
 */

import { describe, expect, it } from "vitest"
import { normalizeIndex } from "../../src/orchestrator/index/store-codec.ts"
import { type Task, toTaskId } from "../../src/types/task.ts"

/**
 * Every property (recursively) present and non-optional. Primitives and
 * primitive unions pass through; records recurse so nested optionals like
 * `deletion.deleteBranch` are forced too.
 */
type DeepRequired<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends string | number | boolean
    ? NonNullable<T[K]>
    : DeepRequired<NonNullable<T[K]>>
}

/**
 * One task with a value in every field. Values are chosen so `coerceTask`'s
 * healing is the identity: `kind: "dir"` keeps `scratch`, and `in_review`
 * is untouched by the status heals — the round-trip must be lossless, so a
 * deliberately-healed fixture would hide a dropped field behind the heal.
 */
const FULL_TASK: DeepRequired<Task> = {
  id: toTaskId("01ARZ3NDEKTSV4RRFFQ69G5FAV"),
  title: "round-trip fixture",
  repo: "/repo",
  branch: "fix/round-trip",
  worktreePath: "/repo/.worktrees/round-trip",
  kind: "dir",
  scratch: true,
  status: "in_review",
  archived: false,
  pinned: true,
  vendor: "claude",
  command: "claude --continue",
  prStatus: {
    provider: "github",
    lifecycle: "open",
    checkState: "passing",
    number: 42,
    url: "https://github.com/o/r/pull/42",
    title: "fix: round trip",
    baseRef: "main",
    headRef: "fix/round-trip",
    reviewDecision: "APPROVED",
    mergeable: "MERGEABLE",
    lastCheckedAt: "2026-08-27T00:00:00.000Z",
    lastError: "transient fetch error",
  },
  position: 1.5,
  modelEffort: "high",
  groupId: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
  deletion: {
    phase: "error",
    force: true,
    deleteBranch: true,
    requestedAt: "2026-08-27T00:00:00.000Z",
    error: "worktree removal failed",
  },
  quotaResume: {
    resumeAt: "2026-08-27T06:00:00.000Z",
    requestedAt: "2026-08-27T00:00:00.000Z",
  },
  linkedWorkItem: {
    provider: "github",
    type: "issue",
    number: 57,
    title: "store-codec drops optional fields",
    url: "https://github.com/o/r/issues/57",
  },
  dispatcher: {
    taskId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
    tabId: "tab-1",
  },
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
}

describe("tasks.json codec round-trip", () => {
  it("preserves every optional field across write → read", () => {
    const written = JSON.parse(JSON.stringify({ version: 3, tasks: [FULL_TASK] }))
    const loaded = normalizeIndex(written, "round-trip-test").tasks
    expect(loaded).toEqual([FULL_TASK])
  })
})
