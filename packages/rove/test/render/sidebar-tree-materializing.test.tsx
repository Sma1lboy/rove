/** @jsxImportSource @opentui/react */
/**
 * The `--count N` fan-out's most visible minute: N freshly created siblings
 * with no branch yet, no engine activity yet, and no tab rows yet, while the
 * daemon publishes `task.jobs {phase:"running"}` for every one of them through
 * a minutes-long `git worktree add`, which its row status folds into each
 * task's rollup as `busy` (reason `job`).
 *
 * The rows the user stares at during that minute are WORKTREE rows, and the
 * task's active TAB row — the natural place for a materializing spinner —
 * does not exist yet, because a tab is only recorded once delivery succeeds.
 * Put the spinner there and the whole fan-out sits frozen on N identical
 * `(new task)` rows.
 *
 * A real mount here rather than a pure assertion on purpose: the claim is
 * "the spinner reaches the frame", and the failure mode is a signal that
 * arrives everywhere except the cells.
 */
import { afterEach, expect, test } from "bun:test"
import { DEFAULT_SPINNER_FRAMES } from "../../src/engine/spinner-frames"
import { SidebarTree } from "../../src/tui-react/panes/sidebar/SidebarTree"
import { resetRowStatusForTests } from "../../src/tui-react/workspace/row-status-sync"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { renderComponent } from "./harness"

const SETTLE = 90
const SPINNER = new Set(DEFAULT_SPINNER_FRAMES)

/** A sibling exactly as `addParallel` creates it: placeholder title, branch
 *  deliberately left empty until `ensureWorktree` names it. */
function sibling(id: string): Task {
  return {
    id: toTaskId(id),
    title: "(new task)",
    repo: "/repos/rove",
    branch: "",
    worktreePath: "",
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } as Task
}

const SIBLINGS = [sibling("s1"), sibling("s2"), sibling("s3")]

/** The daemon's row status with a worktree job in flight for each of `ids`; the rest idle. */
function jobs(ids: readonly string[]): void {
  resetRowStatusForTests(
    Object.fromEntries(
      SIBLINGS.map((task) => [
        task.id,
        {
          task: ids.includes(task.id)
            ? { kind: "busy" as const, reason: "job" as const, since: 1 }
            : { kind: "idle" as const, since: 0 },
          tabs: {},
        },
      ]),
    ),
  )
}

afterEach(() => resetRowStatusForTests())

function spinnerCells(frame: string): number {
  let n = 0
  for (const ch of frame) if (SPINNER.has(ch)) n++
  return n
}

test("every materializing sibling shows a spinner, with no tab row anywhere", async () => {
  tabsByTask.clear()
  jobs(["s1", "s2", "s3"])
  const { frame } = await renderComponent(
    <SidebarTree tasks={SIBLINGS} selectedId="s1" selectedTabId={null} onSelect={() => {}} focused={true} width={30} />,
    { width: 30, height: 20 },
  )
  await new Promise((r) => setTimeout(r, SETTLE))
  const text = await frame()

  // The scene really is the frozen one: three identical placeholder rows…
  expect(text.split("(new task)").length - 1).toBe(3)
  // …and no tab row exists to have carried the indicator.
  expect(tabsByTask.size).toBe(0)
  // One spinner glyph per materializing row.
  expect(spinnerCells(text)).toBe(3)
})

test("only the tasks WITH a job spin — a sibling that finished stops", async () => {
  // The daemon removes an entry on `done`/`error`, so a partially-finished
  // fan-out must show exactly the still-running count, not all-or-nothing.
  tabsByTask.clear()
  jobs(["s2"])
  const { frame } = await renderComponent(
    <SidebarTree tasks={SIBLINGS} selectedId="s1" selectedTabId={null} onSelect={() => {}} focused={true} width={30} />,
    { width: 30, height: 20 },
  )
  await new Promise((r) => setTimeout(r, SETTLE))
  expect(spinnerCells(await frame())).toBe(1)
})

test("the client's own engine activity lights nothing: only the daemon's row status does", async () => {
  // A task-level `running` entry in the TUI's engine-state cache, with the
  // daemon reporting nothing for the task, must not be turned into a status
  // here: the daemon decides, the rail draws.
  tabsByTask.clear()
  const { frame } = await renderComponent(
    <SidebarTree
      tasks={SIBLINGS}
      selectedId="s1"
      selectedTabId={null}
      onSelect={() => {}}
      focused={true}
      width={30}
      engineState={new Map([["s1", { state: "running" as const, at: 1_760_000_000_000 }]])}
    />,
    { width: 30, height: 20 },
  )
  await new Promise((r) => setTimeout(r, SETTLE))
  expect(spinnerCells(await frame())).toBe(0)
})

test("a materializing row shows how far its checkout got, beside the spinner", async () => {
  tabsByTask.clear()
  jobs(["s1", "s2"])
  const { frame } = await renderComponent(
    <SidebarTree
      tasks={SIBLINGS}
      selectedId="s1"
      selectedTabId={null}
      onSelect={() => {}}
      focused={true}
      width={30}
      taskJobs={new Map([["s1", { kind: "ensureWorktree" as const, progress: 42 }]])}
    />,
    { width: 30, height: 20 },
  )
  await new Promise((r) => setTimeout(r, SETTLE))
  const text = await frame()
  const row = text.split("\n").find((line) => line.includes("42%"))
  expect(row && [...row].some((ch) => SPINNER.has(ch))).toBe(true)
  // A job git has not reported a percent for yet shows the spinner alone.
  expect(text.split("%").length - 1).toBe(1)
})
