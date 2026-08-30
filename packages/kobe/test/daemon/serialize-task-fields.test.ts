/**
 * Wire-codec field guard for `serializeTask` — the SECOND hand-written
 * allowlist a Task field has to survive.
 *
 * `store-codec-roundtrip.test.ts` closes the disk side (issue #57: a field
 * writes fine and vanishes on load). This closes the wire side, which is a
 * separate list in `daemon/protocol.ts` with the same failure mode and no
 * coverage before now: a field can round-trip through tasks.json perfectly
 * and still be invisible to every RPC consumer — the TUI, the web board, and
 * `rove api get-task`.
 *
 * That is not hypothetical. `observedLanguage` passed the disk round-trip
 * and was still dropped here; only a live write → daemon restart → read-back
 * caught it. This test makes the next one fail in CI instead.
 *
 * Same technique as the disk guard: `DeepRequired` forces the fixture to
 * name every field at compile time, so a new optional breaks the build here
 * until it is listed, and the assertion then goes red until `serializeTask`
 * carries it.
 */

import { type SerializedTask, serializeTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { describe, expect, it } from "vitest"
import type { Task } from "../../src/types/task.ts"

type DeepRequired<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends string | number | boolean
    ? NonNullable<T[K]>
    : DeepRequired<NonNullable<T[K]>>
}

/**
 * Every field the wire shape can carry, each with a distinguishable value.
 *
 * `archived` is deliberately omitted: it is the DEPRECATED shim from issue
 * #75, kept in the type for old consumers and intentionally never emitted.
 * Requiring it here would pin a field the codebase is trying to shed.
 */
const FULL: Omit<DeepRequired<SerializedTask>, "archived"> = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  title: "wire fixture",
  repo: "/repo",
  branch: "fix/wire",
  worktreePath: "/repo/.worktrees/wire",
  kind: "task",
  scratch: true,
  status: "in_review",
  pinned: true,
  vendor: "claude",
  command: "claude --continue",
  observedLanguage: "zh",
  position: 3.5,
  modelEffort: "high",
  groupId: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  prStatus: {
    provider: "github",
    lifecycle: "open",
    checkState: "passing",
    number: 42,
    url: "https://github.com/o/r/pull/42",
    title: "fix: wire",
    baseRef: "main",
    headRef: "fix/wire",
    reviewDecision: "APPROVED",
    mergeable: "MERGEABLE",
    lastCheckedAt: "2026-08-30T00:00:00.000Z",
    lastError: "none",
  },
  deletion: {
    phase: "queued",
    force: true,
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
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
}

describe("serializeTask", () => {
  it("puts every wire field on the wire", () => {
    const serialized = serializeTask(FULL as unknown as Task)
    for (const [key, value] of Object.entries(FULL)) {
      expect(serialized[key as keyof SerializedTask], `serializeTask dropped "${key}"`).toEqual(value)
    }
  })

  it("carries the observed language, which a daemon restart used to erase", () => {
    // The regression this file was written for: persisted fine, invisible to
    // every RPC reader, so injected prompts silently reverted to English.
    expect(serializeTask({ ...FULL, observedLanguage: "zh" } as unknown as Task).observedLanguage).toBe("zh")
    expect(serializeTask({ ...FULL, observedLanguage: undefined } as unknown as Task).observedLanguage).toBeUndefined()
  })
})
