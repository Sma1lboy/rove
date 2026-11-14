/** @jsxImportSource @opentui/react */
/**
 * An issue that already has a task opens that task on enter instead of
 * starting a second one, and shows the task on its detail line.
 */

import { expect, test } from "bun:test"
import { WorkItemsPage } from "../../src/bundled-plugins/issues/work-items-page"
import { renderComponent, settle, waitForFrameText } from "./harness"

const REPO = "/x/rove"
const ITEM = { number: 412, title: "Fix the thing", author: "octocat", labels: [], updatedAt: new Date().toISOString() }

/** Poll `check` with a cap: the page's item list and enter handler resolve asynchronously. */
async function until(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) await settle(25)
}

function orch(tasks: unknown[], startWorkItem: () => Promise<unknown>) {
  return { listTasks: () => tasks, listWorkItems: async () => ({ items: [ITEM] }), startWorkItem } as never
}

test("enter on an already-started issue opens its task, never a second start", async () => {
  let starts = 0
  const opened: string[] = []
  const linked = { id: "T1", repo: REPO, title: "issue-412-fix", linkedWorkItem: { number: 412, title: "x", url: "u" } }
  const { frame, mockInput } = await renderComponent(
    <WorkItemsPage
      orchestrator={orch([linked], async () => ({ started: true, taskId: `T${++starts + 1}`, title: "dup" }))}
      focused={true}
      onClose={() => {}}
      onOpenTask={(id) => opened.push(id)}
    />,
    { width: 90, height: 12, providers: { notifications: true } },
  )
  await waitForFrameText(frame, "→ issue-412-fix")
  mockInput.pressEnter()
  await until(() => opened.length === 1)
  mockInput.pressEnter()
  await until(() => opened.length === 2)
  expect(starts).toBe(0)
  expect(opened).toEqual(["T1", "T1"])
})

test("Windows project spellings select and reuse the existing linked task", async () => {
  let starts = 0
  const opened: string[] = []
  const linked = { id: "T1", repo: "C:\\Projects\\demo", title: "windows-issue", linkedWorkItem: { number: 412 } }
  const { frame, mockInput } = await renderComponent(
    <WorkItemsPage
      orchestrator={orch(
        [{ id: "other", repo: "C:/Projects/other" }, { id: "main", repo: "C:/Projects/demo" }, linked],
        async () => ({ started: true, taskId: `new-${++starts}` }),
      )}
      focusRepo="c:\\Projects\\demo"
      focused={true}
      onClose={() => {}}
      onOpenTask={(id) => opened.push(id)}
    />,
    { width: 90, height: 12, providers: { notifications: true } },
  )
  await waitForFrameText(frame, "Fix the thing")
  mockInput.pressEnter()
  await until(() => opened.length > 0)
  expect(starts).toBe(0)
  expect(opened).toEqual(["T1"])
})

test("a task on another repo or issue does not count as linked", async () => {
  let starts = 0
  const other = [
    { id: "A", repo: "/x/other", title: "elsewhere", linkedWorkItem: { number: 412, title: "x", url: "u" } },
    { id: "B", repo: REPO, title: "sibling", linkedWorkItem: { number: 413, title: "x", url: "u" } },
  ]
  const { frame, mockInput } = await renderComponent(
    <WorkItemsPage
      orchestrator={orch(other, async () => ({ started: true, taskId: `T${++starts}`, title: "new" }))}
      focusRepo={REPO}
      focused={true}
      onClose={() => {}}
    />,
    { width: 90, height: 12, providers: { notifications: true } },
  )
  expect(await waitForFrameText(frame, "Fix the thing")).not.toContain("→ ")
  mockInput.pressEnter()
  await until(() => starts > 0)
  expect(starts).toBe(1)
})
