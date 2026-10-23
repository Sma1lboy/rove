/** @jsxImportSource @opentui/react */
/**
 * The sidebar draws the daemon's row status (`row.status`) and nothing else.
 *
 * - a TASK row shows the status of its conversation: spinner, `?`, `!` (amber
 *   for a rate limit, red for an error), `●` for a finish nobody has seen,
 *   `○` at rest; a task-level job or deletion (`busy`) spins over any of them;
 * - a migrated child shows the status of the parent's tab its conversation
 *   still lives in;
 * - the workspace reports what it shows (`ui.viewing`) as the tab changes.
 */

import { afterEach, expect, test } from "bun:test"
import type { BoxRenderable } from "@opentui/core"
import type { RowStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import type { RowStatusPayload } from "@sma1lboy/rove-daemon/daemon/row-status-store"
import type { RowStatusTransport } from "../../src/client/remote-orchestrator-row-status"
import { createStateCell } from "../../src/lib/external-store"
import { useAccessor } from "../../src/tui-react/lib/use-accessor"
import type { TreeRowShared } from "../../src/tui-react/panes/sidebar/tree-row-shell"
import { WorktreeTreeRow } from "../../src/tui-react/panes/sidebar/tree-rows"
import {
  acceptRemoteActivity,
  attachRowStatusTransport,
  resetRowStatusForTests,
  useViewingReport,
} from "../../src/tui-react/workspace/row-status-sync"
import { DEFAULT_GLYPHS } from "../../src/tui/lib/glyphs"
import { type Task, toTaskId } from "../../src/types/task"
import { act, renderComponent, settle } from "./harness"

const TASK: Task = {
  id: toTaskId("alpha"),
  title: "alpha",
  repo: "/repos/rove",
  branch: "feat/alpha",
  worktreePath: "/wt/alpha",
  kind: "task",
  status: "in_progress",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
}

const NOW = Date.now()

function shared(): TreeRowShared {
  return {
    width: 30,
    cursorIndex: -1,
    activeRowId: null,
    selectedTaskId: null,
    rowEls: new Map<number, BoxRenderable>(),
    onPress: () => {},
    branchTick: 0,
  }
}

function seed(task: RowStatus): void {
  resetRowStatusForTests({ alpha: { task, tabs: {} } })
}

/** The task row's glyph cell: its text (the cell before the label) and ink. */
async function taskCell(task: Task = TASK): Promise<{ text: string; fg: number[] | undefined }> {
  const { spans } = await renderComponent(
    <WorktreeTreeRow rowId={task.id} flatIndex={0} task={task} shared={shared()} />,
    { width: 30, height: 3 },
  )
  await settle(30)
  const label = task.title
  // Joined per line: a running label may shimmer, one span per character.
  const line = (await spans()).lines.find((l) =>
    l.spans
      .map((s) => s.text)
      .join("")
      .includes(label),
  )
  const text = (line?.spans.map((s) => s.text).join("") ?? "").split(label)[0]?.replace("▎", "").trim() ?? ""
  // A quiet glyph shares the label's muted ink, so the two may come back as one span.
  const cell = line?.spans.find((s) => text.length > 0 && s.text.includes(text))
  return { text, fg: cell?.fg?.toInts() }
}

async function statusCell(status: RowStatus): Promise<{ text: string; fg: number[] | undefined }> {
  seed(status)
  return await taskCell()
}

afterEach(() => resetRowStatusForTests())

test("a task row draws the daemon's status for its conversation", async () => {
  const running = await statusCell({ kind: "running", since: NOW, state: "running" })
  expect(DEFAULT_GLYPHS.spinner).toContain(running.text)

  const asks = await statusCell({ kind: "needs-input", since: NOW, state: "permission_needed" })
  expect(asks.text).toBe(DEFAULT_GLYPHS.needsInput)

  const limited = await statusCell({ kind: "attention", reason: "rate_limited", since: NOW })
  const errored = await statusCell({ kind: "attention", reason: "error", since: NOW })
  expect(limited.text).toBe(DEFAULT_GLYPHS.attention)
  expect(errored.text).toBe(DEFAULT_GLYPHS.attention)
  // Same `!`, two tones: a wait you can clear is amber like a question, a
  // failure is red.
  expect(limited.fg).toEqual(asks.fg)
  expect(limited.fg).not.toEqual(errored.fg)

  const unseen = await statusCell({ kind: "unseen", since: NOW, state: "turn_complete" })
  expect(unseen.text).toBe(DEFAULT_GLYPHS.unseen)

  const idle = await statusCell({ kind: "idle", since: NOW, state: "turn_complete" })
  expect(idle.text).toBe(DEFAULT_GLYPHS.idle)
})

test("a migrated child draws the status of the parent's tab its conversation lives in", async () => {
  const alive = { alive: true, restored: false, tracked: true } as const
  resetRowStatusForTests({
    alpha: {
      task: { kind: "running", since: NOW },
      tabs: {
        "tab-1": { kind: "running", since: NOW, ...alive },
        "tab-2": { kind: "needs-input", since: NOW, ...alive },
      },
    },
    beta: { task: { kind: "idle", since: 0 }, tabs: {} },
  })
  const child: Task = {
    ...TASK,
    id: toTaskId("beta"),
    title: "child",
    parentTaskId: TASK.id,
    ptyAlias: { taskId: "alpha", tabId: "tab-2" },
  }
  expect((await taskCell(child)).text).toBe(DEFAULT_GLYPHS.needsInput)
})

test("another machine's task row shows the status built from the hub's relayed tab readings", async () => {
  // Not in the local snapshot: the store builds it from relayed engine-state.
  acceptRemoteActivity(
    new Map(),
    new Map([
      [
        "alpha",
        new Map([
          ["tab-1", { state: "running" as const, at: NOW }],
          ["tab-2", { state: "permission_needed" as const, at: NOW }],
        ]),
      ],
    ]),
  )
  // A question outranks a sibling that is still working.
  expect((await taskCell()).text).toBe(DEFAULT_GLYPHS.needsInput)
})

test("a task-level job spins the task row", async () => {
  seed({ kind: "busy", reason: "job", since: NOW })
  const { frame } = await renderComponent(
    <WorktreeTreeRow rowId="alpha" flatIndex={0} task={TASK} shared={shared()} />,
    {
      width: 30,
      height: 3,
    },
  )
  await settle(30)
  const row = (await frame()).split("\n").find((line) => line.includes("alpha")) ?? ""
  expect(DEFAULT_GLYPHS.spinner.some((frame) => row.includes(frame))).toBe(true)
})

/** The shown tab, as a module store the way the workspace reads the daemon's tabs (`tabs-sync.ts`). */
const shownTab = createStateCell("tab-1")

/** Stands in for the workspace pane: reports the tab it shows. */
function Viewer() {
  const tab = useAccessor(shownTab)
  useViewingReport("alpha", tab)
  return <text>{tab}</text>
}

test("switching tabs reports ui.viewing for the new tab, and leaving reports none", async () => {
  const viewing: [string | null, string | null | undefined][] = []
  const transport: RowStatusTransport = {
    list: async (): Promise<RowStatusPayload> => ({ tasks: {}, rev: 0 }),
    viewing: async (taskId, tabId) => {
      viewing.push([taskId, tabId])
    },
    answered: async () => {},
    onChanged: () => () => {},
  }
  resetRowStatusForTests()
  attachRowStatusTransport(transport)
  shownTab.set("tab-1")
  const { frame, destroy } = await renderComponent(<Viewer />, { width: 20, height: 2 })
  await frame()
  await act(async () => shownTab.set("tab-2"))
  // The report is an effect: give the commit its turn under a loaded runner.
  for (let i = 0; i < 50 && viewing.length < 2; i++) await settle(20)
  expect(viewing).toEqual([
    ["alpha", "tab-1"],
    ["alpha", "tab-2"],
  ])
  destroy()
  // The unmount report rides a cleanup effect: wait for it in real time, bounded (a loaded runner is slow).
  for (let deadline = Date.now() + 2_000; Date.now() < deadline; ) {
    const last = viewing.at(-1)
    if (last?.[0] === null && last?.[1] === null) break
    await settle(20)
  }
  expect(viewing.at(-1)).toEqual([null, null])
})
