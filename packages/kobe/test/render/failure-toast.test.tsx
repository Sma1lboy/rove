/** @jsxImportSource @opentui/react */
/**
 * Failed mutations must be VISIBLE — the regression this branch fixes:
 *
 *   - Kanban issue create/delete logged to the daemon log only; under the
 *     alternate screen a bare `console.error` is invisible, so the card just
 *     stayed on the board.
 *   - Automations / Work-items failures rendered as a muted `textMuted`
 *     inline line — reads as a hint, not a failure.
 *
 * All three pages now push failures through the shared toast queue. Each
 * test mounts the REAL page plus the REAL `ToastOverlay` and drives the REAL
 * keys (down/d/enter, e, return) against a rejecting orchestrator mock, then
 * asserts the error toast painted on the frame — the "✕" glyph the toast
 * overlay draws, which no pre-fix rendering produced.
 */
import { expect, test } from "bun:test"
import { createStateCell } from "../../src/lib/external-store"
import { AutomationsPage } from "../../src/tui-react/component/automations-page"
import { KanbanPage } from "../../src/tui-react/component/kanban-page"
import { ToastOverlay } from "../../src/tui-react/component/toast-overlay"
import { WorkItemsPage } from "../../src/tui-react/component/work-items-page"
import { renderComponent, settle } from "./harness"

const REPO = "/repos/rove"

function issue(id: number, over: Record<string, unknown> = {}) {
  return { id, title: `story-${id}`, status: "open", created: "2026-08-01", body: "", ...over }
}

/** Flatten the captured frame into a list of colored spans. */
async function coloredSpans(spans: () => Promise<import("@opentui/core").CapturedFrame>) {
  return (await spans()).lines.flatMap((line) => line.spans)
}

/**
 * The failure is a TOAST, not the page's muted notice line: some span must
 * carry the "✕" toast glyph, and the span carrying `message` must not paint
 * with the same color as `mutedNeedle`'s span (the pre-fix `textMuted` look).
 */
async function expectErrorToast(
  frame: string,
  spans: () => Promise<import("@opentui/core").CapturedFrame>,
  message: string,
  mutedNeedle: string,
): Promise<void> {
  expect(frame).toContain("✕")
  expect(frame).toContain(message)
  const all = await coloredSpans(spans)
  const messageSpan = all.find((span) => span.text.includes(message))
  const mutedSpan = all.find((span) => span.text.includes(mutedNeedle))
  expect(messageSpan).toBeDefined()
  expect(mutedSpan).toBeDefined()
  if (!messageSpan || !mutedSpan) return
  expect(messageSpan.fg.equals(mutedSpan.fg)).toBe(false)
}

test("kanban: a failed issue delete shows an error toast, not just a log line", async () => {
  const orch = {
    listTasks: () => [{ repo: REPO }],
    listIssues: async () => ({ repoRoot: REPO, exists: true, nextId: 9, issues: [issue(1)] }),
    activeTaskSignal: () => ({ get: () => null }),
    mutateIssue: async () => {
      throw new Error("issues store is read-only")
    },
  } as never
  const { frame, spans, mockInput } = await renderComponent(
    <>
      <KanbanPage
        orchestrator={orch}
        focused={true}
        onClose={() => {}}
        onStartChat={async () => {}}
        onOpenTask={() => {}}
      />
      <ToastOverlay />
    </>,
    { width: 120, height: 30, providers: { dialog: true, kv: true, notifications: true } },
  )
  await settle()
  // Select the only card, request delete, confirm — the RPC rejects.
  mockInput.pressArrow("down")
  await settle()
  mockInput.typeText("d")
  await settle()
  expect(await frame()).toContain("Delete story #1?")
  // Danger confirms open focused on Cancel — move onto the confirm button.
  mockInput.pressArrow("right")
  await settle()
  mockInput.pressEnter()
  await settle(150)
  const text = await frame()
  expect(text).toContain("story-1")
  await expectErrorToast(text, spans, "Couldn't delete story #1", "No cards")
})

test("kanban: a failed issue create shows an error toast", async () => {
  const orch = {
    listTasks: () => [{ repo: REPO }],
    listIssues: async () => ({ repoRoot: REPO, exists: true, nextId: 9, issues: [issue(1)] }),
    activeTaskSignal: () => ({ get: () => null }),
    mutateIssue: async () => {
      throw new Error("issues store is read-only")
    },
  } as never
  const { frame, spans, mockInput } = await renderComponent(
    <>
      <KanbanPage
        orchestrator={orch}
        focused={true}
        onClose={() => {}}
        onStartChat={async () => {}}
        onOpenTask={() => {}}
      />
      <ToastOverlay />
    </>,
    { width: 120, height: 30, providers: { dialog: true, kv: true, notifications: true } },
  )
  await settle()
  mockInput.typeText("n")
  await settle()
  expect(await frame()).toContain("NEW STORY")
  mockInput.typeText("the new story")
  await settle()
  mockInput.typeText("\x13") // ctrl+s — file without starting
  await settle(150)
  await expectErrorToast(await frame(), spans, "Couldn't create the story", "No cards")
})

const AUTOMATION = {
  id: "a1",
  name: "weekday audit",
  repo: "/x/kobe",
  prompt: "audit",
  schedule: "0 9 * * MON-FRI",
  enabled: true,
  nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
  missedRunGraceMinutes: 60,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
}

/** The page reads the daemon connection signal to decide whether its
 *  daemon-hold state is still a claim it can make (daemon-down-banner.test.tsx).
 *  Hoisted so `useSyncExternalStore` sees one stable store identity. */
const ONLINE = createStateCell("online")

test("automations: a failed delete shows an error toast instead of a muted line", async () => {
  const orch = {
    connectionStateSignal: () => ONLINE,
    listAutomations: async () => ({ automations: [AUTOMATION], keepsDaemonAlive: true }),
    automationRuns: async () => ({ runs: [] }),
    listTasks: () => [{ repo: "/x/kobe" }],
    deleteAutomation: async () => {
      throw new Error("daemon refused")
    },
  } as never
  const { frame, spans, mockInput } = await renderComponent(
    <>
      <AutomationsPage orchestrator={orch} focused={true} onClose={() => {}} />
      <ToastOverlay />
    </>,
    { width: 90, height: 22, providers: { dialog: true, notifications: true } },
  )
  await settle(150)
  mockInput.typeText("d")
  await settle()
  expect(await frame()).toContain("Delete routine?")
  // Danger confirms open focused on Cancel — move onto the confirm button.
  mockInput.pressArrow("right")
  await settle()
  mockInput.pressEnter()
  await settle(150)
  await expectErrorToast(await frame(), spans, "daemon refused", "in 1h")
})

test("automations: a failed toggle shows an error toast", async () => {
  const orch = {
    connectionStateSignal: () => ONLINE,
    listAutomations: async () => ({ automations: [AUTOMATION], keepsDaemonAlive: true }),
    automationRuns: async () => ({ runs: [] }),
    listTasks: () => [{ repo: "/x/kobe" }],
    setAutomationEnabled: async () => {
      throw new Error("daemon refused")
    },
  } as never
  const { frame, spans, mockInput } = await renderComponent(
    <>
      <AutomationsPage orchestrator={orch} focused={true} onClose={() => {}} />
      <ToastOverlay />
    </>,
    { width: 90, height: 22, providers: { dialog: true, notifications: true } },
  )
  await settle(150)
  mockInput.typeText("e")
  await settle(150)
  await expectErrorToast(await frame(), spans, "daemon refused", "in 1h")
})

const WORK_ITEM = {
  number: 42,
  title: "Fix the thing",
  author: "octocat",
  labels: ["bug", "p2"],
  updatedAt: new Date().toISOString(),
}

function workItemsOrch(over: Record<string, unknown> = {}) {
  return {
    listTasks: () => [{ repo: "/x/kobe" }],
    listWorkItems: async () => ({ items: [WORK_ITEM] }),
    ...over,
  } as never
}

test("work-items: a failed start shows an error toast instead of a muted line", async () => {
  const orch = workItemsOrch({
    startWorkItem: async () => {
      throw new Error("gh CLI missing")
    },
  })
  const { frame, spans, mockInput } = await renderComponent(
    <>
      <WorkItemsPage orchestrator={orch} focused={true} onClose={() => {}} />
      <ToastOverlay />
    </>,
    { width: 90, height: 20, providers: { notifications: true } },
  )
  await settle(150)
  mockInput.pressEnter()
  await settle(150)
  // Muted reference: the repo label in the header renders `textMuted`; the
  // toast title must not share that color.
  await expectErrorToast(await frame(), spans, "Couldn't start work on #42", "kobe")
})

test("work-items: the muted inline line stays for non-failure progress", async () => {
  // The notice mechanism survives for status text — "starting" renders as the
  // quiet inline line, not an error toast.
  let resolveStart: ((value: { started: boolean; taskId: string; title: string }) => void) | undefined
  const orch = workItemsOrch({
    startWorkItem: () =>
      new Promise((resolve) => {
        resolveStart = resolve
      }),
  })
  const { frame, mockInput } = await renderComponent(
    <>
      <WorkItemsPage orchestrator={orch} focused={true} onClose={() => {}} />
      <ToastOverlay />
    </>,
    { width: 90, height: 20, providers: { notifications: true } },
  )
  await settle(150)
  mockInput.pressEnter()
  await settle(150)
  const text = await frame()
  expect(text).toContain("Starting work on #42")
  expect(text).not.toContain("✕")
  resolveStart?.({ started: true, taskId: "T1", title: "Fix the thing" })
  await settle(150)
})

test("work-items: a started item opens its task", async () => {
  let opened: string | undefined
  const orch = workItemsOrch({
    startWorkItem: async () => ({ started: true, taskId: "T9", title: "Fix the thing" }),
  })
  const { mockInput } = await renderComponent(
    <WorkItemsPage
      orchestrator={orch}
      focused={true}
      onClose={() => {}}
      onOpenTask={(id) => {
        opened = id
      }}
    />,
    { width: 90, height: 20, providers: { notifications: true } },
  )
  await settle(150)
  mockInput.pressEnter()
  await settle(200)
  expect(opened).toBe("T9")
})

test("work-items: an item whose engine did not start says so inline", async () => {
  const orch = workItemsOrch({
    startWorkItem: async () => ({ started: false, taskId: "T9", title: "Fix the thing" }),
  })
  const { frame, mockInput } = await renderComponent(
    <WorkItemsPage orchestrator={orch} focused={true} onClose={() => {}} />,
    { width: 90, height: 20, providers: { notifications: true } },
  )
  await settle(150)
  mockInput.pressEnter()
  await settle(200)
  expect(await frame()).toContain("its engine did not start")
})

test("work-items: list rows render with number, labels, and age", async () => {
  const { frame } = await renderComponent(
    <WorkItemsPage orchestrator={workItemsOrch()} focused={true} onClose={() => {}} />,
    { width: 90, height: 20, providers: { notifications: true } },
  )
  await settle(150)
  const text = await frame()
  expect(text).toContain("#42")
  expect(text).toContain("Fix the thing")
  expect(text).toContain("octocat · bug · p2")
  expect(text).toContain("0m")
})

test("work-items: a failed list names the fix inline", async () => {
  const orch = workItemsOrch({
    listWorkItems: async () => {
      throw new Error("no-remote: origin is not a GitHub remote")
    },
  })
  const { frame } = await renderComponent(<WorkItemsPage orchestrator={orch} focused={true} onClose={() => {}} />, {
    width: 90,
    height: 20,
    providers: { notifications: true },
  })
  await settle(200)
  const text = await frame()
  expect(text).toContain("no-remote: origin is not a GitHub remote")
  expect(text).toContain("git remote add origin")
})

test("work-items: no issues renders the empty state", async () => {
  const orch = workItemsOrch({ listWorkItems: async () => ({ items: [] }) })
  const { frame } = await renderComponent(<WorkItemsPage orchestrator={orch} focused={true} onClose={() => {}} />, {
    width: 90,
    height: 20,
    providers: { notifications: true },
  })
  await settle(150)
  expect(await frame()).toContain("No open issues.")
})
