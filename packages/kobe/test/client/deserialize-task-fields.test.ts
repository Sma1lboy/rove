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

import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { describe, expect, it } from "vitest"
import { deserializeTask } from "../../src/client/remote-orchestrator-payloads.ts"

type DeepRequired<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends string | number | boolean
    ? NonNullable<T[K]>
    : DeepRequired<NonNullable<T[K]>>
}

/** Every field the wire can carry, each with a distinguishable value. */
const FULL: DeepRequired<SerializedTask> = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  title: "decode fixture",
  repo: "/repo",
  branch: "fix/decode",
  worktreePath: "/repo/.worktrees/decode",
  kind: "task",
  scratch: true,
  routine: { automationId: "auto-1" },
  status: "in_review",
  pinned: true,
  vendor: "claude",
  command: "claude --dangerously-skip-permissions",
  observedLanguage: "zh",
  modelEffort: "high",
  groupId: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  prStatus: {
    provider: "github",
    lifecycle: "open",
    checkState: "passing",
    number: 42,
    url: "https://github.com/o/r/pull/42",
    title: "fix: decode",
    baseRef: "main",
    headRef: "fix/decode",
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
  prompt: "the full task brief — never truncated on the way off the wire",
  baseRef: "release/2.x",
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
