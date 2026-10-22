/** @jsxImportSource @opentui/react */
/**
 * The sidebar draws the daemon's row status (`row.status`) and nothing else.
 *
 * - a TAB row shows its own tab's status: spinner, `?`, `!` (amber for a rate
 *   limit, red for an error), `●` for a finish nobody has seen, `○` at rest;
 * - a TASK row shows the task rollup only when its tabs are not listed under
 *   it; with its tab list showing it carries no activity glyph, except the
 *   rollup's `busy` (a job or deletion);
 * - the workspace reports what it shows (`ui.viewing`) as the tab changes.
 */

import { afterEach, expect, test } from "bun:test"
import type { BoxRenderable } from "@opentui/core"
import type { RowStatus, TabStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import type { RowStatusPayload } from "@sma1lboy/rove-daemon/daemon/row-status-store"
import type { RowStatusTransport } from "../../src/client/remote-orchestrator-row-status"
import { createStateCell } from "../../src/lib/external-store"
import { useAccessor } from "../../src/tui-react/lib/use-accessor"
import type { TreeRowShared } from "../../src/tui-react/panes/sidebar/tree-row-shell"
import { TabTreeRow, WorktreeTreeRow } from "../../src/tui-react/panes/sidebar/tree-rows"
import {
  acceptRemoteActivity,
  attachRowStatusTransport,
  resetRowStatusForTests,
  useViewingReport,
} from "../../src/tui-react/workspace/row-status-sync"
import { DEFAULT_GLYPHS } from "../../src/tui/lib/glyphs"
import type { TreeTab } from "../../src/tui/panes/sidebar/tree-core"
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

const TAB: TreeTab = { id: "tab-1", label: "build", engine: true }
const SESSION = { alive: true, restored: false, tracked: true } as const
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

function seed(task: RowStatus, tab?: TabStatus): void {
  resetRowStatusForTests({ alpha: { task, tabs: tab ? { "tab-1": tab } : {} } })
}

/** The tab row's glyph cell: its text (the cell before the label) and ink. */
async function tabCell(status: TabStatus): Promise<{ text: string; fg: number[] | undefined }> {
  seed(status, status)
  const { spans } = await renderComponent(
    <TabTreeRow rowId="alpha::tab-1" flatIndex={0} task={TASK} tab={TAB} shared={shared()} />,
    { width: 30, height: 3 },
  )
  await settle(30)
  // Joined per line: a running label may shimmer, one span per character.
  const line = (await spans()).lines.find((l) =>
    l.spans
      .map((s) => s.text)
      .join("")
      .includes("build"),
  )
  const text = (line?.spans.map((s) => s.text).join("") ?? "").split("build")[0]?.replace("▎", "").trim() ?? ""
  // A quiet glyph shares the label's muted ink, so the two may come back as one span.
  const cell = line?.spans.find((s) => text.length > 0 && s.text.includes(text))
  return { text, fg: cell?.fg?.toInts() }
}

afterEach(() => resetRowStatusForTests())

test("a tab row draws the daemon's status for that tab", async () => {
  const running = await tabCell({ kind: "running", since: NOW, state: "running", ...SESSION })
  expect(DEFAULT_GLYPHS.spinner).toContain(running.text)

  const asks = await tabCell({ kind: "needs-input", since: NOW, state: "permission_needed", ...SESSION })
  expect(asks.text).toBe(DEFAULT_GLYPHS.needsInput)

  const limited = await tabCell({ kind: "attention", reason: "rate_limited", since: NOW, ...SESSION })
  const errored = await tabCell({ kind: "attention", reason: "error", since: NOW, ...SESSION })
  expect(limited.text).toBe(DEFAULT_GLYPHS.attention)
  expect(errored.text).toBe(DEFAULT_GLYPHS.attention)
  // Same `!`, two tones: a wait you can clear is amber like a question, a
  // failure is red.
  expect(limited.fg).toEqual(asks.fg)
  expect(limited.fg).not.toEqual(errored.fg)

  const unseen = await tabCell({ kind: "unseen", since: NOW, state: "turn_complete", ...SESSION })
  expect(unseen.text).toBe(DEFAULT_GLYPHS.unseen)

  const idle = await tabCell({ kind: "idle", since: NOW, state: "turn_complete", ...SESSION })
  expect(idle.text).toBe(DEFAULT_GLYPHS.idle)
})

async function worktreeFrame(tabsListed: boolean): Promise<string> {
  const { frame } = await renderComponent(
    <WorktreeTreeRow rowId="alpha" flatIndex={0} task={TASK} tabsListed={tabsListed} shared={shared()} />,
    { width: 30, height: 3 },
  )
  await settle(30)
  return await frame()
}

test("a task row shows no status, listed tabs or not: status lives on tab rows", async () => {
  seed({ kind: "needs-input", since: NOW, state: "permission_needed" })
  // (A trailing `?` on the row is the unknown-changes mark, not a status.)
  expect(await worktreeFrame(false)).not.toContain(`${DEFAULT_GLYPHS.needsInput} feat/alpha`)
  expect(await worktreeFrame(true)).not.toContain(`${DEFAULT_GLYPHS.needsInput} feat/alpha`)

  seed({ kind: "unseen", since: NOW })
  expect(await worktreeFrame(false)).not.toContain(`${DEFAULT_GLYPHS.unseen} feat/alpha`)
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
  // The status shows on the tab rows, not on the task row.
  expect(await worktreeFrame(false)).not.toContain(`${DEFAULT_GLYPHS.needsInput} feat/alpha`)
  const { frame } = await renderComponent(
    <TabTreeRow rowId="alpha::tab-1" flatIndex={0} task={TASK} tab={TAB} shared={shared()} />,
    { width: 30, height: 3 },
  )
  await settle(30)
  const running = await frame()
  expect(DEFAULT_GLYPHS.spinner.some((g) => running.includes(`${g} build`))).toBe(true)
})

test("a task-level job spins the task row even with its tabs listed", async () => {
  seed({ kind: "busy", reason: "job", since: NOW })
  const listed = await worktreeFrame(true)
  // The spinner sits at the row's right edge (#1367), on the task's own line.
  const row = listed.split("\n").find((line) => line.includes("feat/alpha")) ?? ""
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
