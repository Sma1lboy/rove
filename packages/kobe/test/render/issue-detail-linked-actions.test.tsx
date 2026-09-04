/** @jsxImportSource @opentui/react */
/**
 * The linked story's half of the drawer: the two action chips and the EVENTS
 * feed under them. Both only exist when the story HAS a task — a startable
 * story renders the engine/workspace pickers instead — so nothing else in the
 * render track reaches them.
 *
 * Unlink is the only way a card whose task is gone gets back to Backlog, and
 * the chip's border says which action enter will fire. A chip drawn as
 * focused whose binding was never registered looks identical to one that
 * works, so the test presses the keys rather than reading the frame alone.
 */

import { expect, test } from "bun:test"
import type { ReactNode } from "react"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { IssueDetailDialogView, type IssueDetailOutcome } from "../../src/tui-react/component/issue-detail-dialog"
import { act, renderComponent } from "./harness"

const LINKED_ISSUE = {
  id: 7,
  title: "Cache the rate table",
  status: "doing" as const,
  created: "2026-08-20",
  body: "The lookup runs per request.",
  taskId: "01KZTASKLINKED",
}

/** Just the one call the EVENTS feed makes — everything else stays absent so
 *  a second dependency can't creep in unnoticed. */
function orchestratorWithEvents(events: readonly unknown[]): RemoteOrchestrator {
  return {
    recentTaskEvents: () => Promise.resolve({ events }),
  } as unknown as RemoteOrchestrator
}

/** The feed's fetch resolves a microtask after mount, so the first captured
 *  frame still says "Loading events…". Drain it before reading rows. */
function flushFeed(): Promise<void> {
  return act(async () => {})
}

function drawer(onSubmit: (outcome: IssueDetailOutcome) => void, orchestrator: RemoteOrchestrator | null): ReactNode {
  return (
    <IssueDetailDialogView
      issue={LINKED_ISSUE}
      engines={["claude"]}
      defaultVendor="claude"
      engineLabel={() => "Claude"}
      orchestrator={orchestrator}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />
  )
}

test("tab moves from Open to Unlink and enter drops the task link", async () => {
  const outcomes: IssueDetailOutcome[] = []
  const { frame, mockInput } = await renderComponent(
    drawer((outcome) => outcomes.push(outcome), null),
    { width: 120, height: 60, providers: { dialog: true } },
  )

  expect(await frame()).toContain("Unlink")

  // Focus opens on Open — enter there would jump at the task instead.
  act(() => mockInput.pressTab())
  act(() => mockInput.pressEnter())

  expect(outcomes).toEqual([{ kind: "unlink", title: LINKED_ISSUE.title, body: LINKED_ISSUE.body }])
})

test("enter on the Open chip resolves with the linked task id", async () => {
  const outcomes: IssueDetailOutcome[] = []
  const { mockInput, rerender } = await renderComponent(
    drawer((outcome) => outcomes.push(outcome), null),
    { width: 120, height: 60, providers: { dialog: true } },
  )
  await rerender()

  act(() => mockInput.pressEnter())

  expect(outcomes).toEqual([
    { kind: "open", taskId: LINKED_ISSUE.taskId, title: LINKED_ISSUE.title, body: LINKED_ISSUE.body },
  ])
})

test("the events feed renders the task's engine lifecycle, newest first", async () => {
  const now = Date.now()
  const { frame } = await renderComponent(
    drawer(
      () => {},
      orchestratorWithEvents([
        { kind: "turn-start", at: now - 20 * 60_000, vendor: "claude" },
        { kind: "tool-use", at: now - 5 * 60_000, vendor: "claude", detail: { tool: { name: "Bash" } } },
      ]),
    ),
    { width: 120, height: 60, providers: { dialog: true } },
  )

  await flushFeed()
  const rendered = await frame()
  expect(rendered).toContain("Bash · claude")
  expect(rendered).toContain("turn-start")
  expect(rendered.indexOf("tool-use")).toBeLessThan(rendered.indexOf("turn-start"))
})

test("no orchestrator reads as an empty feed, not an error", async () => {
  const { frame } = await renderComponent(
    drawer(() => {}, null),
    {
      width: 120,
      height: 60,
      providers: { dialog: true },
    },
  )

  await flushFeed()
  const rendered = await frame()
  expect(rendered).toContain("EVENTS")
  expect(rendered).toContain("No engine events recorded yet.")
})

test("a daemon that no longer knows the task also reads as empty", async () => {
  const { frame } = await renderComponent(
    drawer(() => {}, {
      recentTaskEvents: () => Promise.reject(new Error("task not found")),
    } as unknown as RemoteOrchestrator),
    { width: 120, height: 60, providers: { dialog: true } },
  )

  await flushFeed()
  const rendered = await frame()
  expect(rendered).toContain("EVENTS")
  expect(rendered).toContain("No engine events recorded yet.")
})
