/** @jsxImportSource @opentui/react */
/**
 * Second wave of "failed mutations must be VISIBLE" (see failure-toast.test.tsx
 * for the first). These cover the paths that wave missed, where the failure was
 * indistinguishable from success rather than merely quiet:
 *
 *   - Kanban's detail-drawer EDIT: the board redraws from the store on save, so
 *     a rejected update left the card showing its OLD title — reading as an
 *     edit that never happened, not as a refused write.
 *   - The terminal's acquire-failure state: F5 is advertised as the recovery
 *     key but `requestReset` returned early on `!pty`, which is exactly the
 *     state an acquire failure leaves behind. The pane had no exit at all.
 *
 * Each test drives the REAL keys against a rejecting/throwing dependency and
 * asserts what REACHED THE USER — the toast glyph painted on the frame, or the
 * recovered terminal contents. Asserting "the callback ran" is what let the
 * original bugs ship green.
 */
import { expect, test } from "bun:test"
import { useEffect } from "react"
import { KanbanPage } from "../../src/tui-react/component/kanban-page"
import { ToastOverlay } from "../../src/tui-react/component/toast-overlay"
import { useNotifications } from "../../src/tui-react/context/notifications"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import { useWorkspaceSelection } from "../../src/tui-react/workspace/use-workspace-selection"
import { MockTaskPty } from "../../src/tui/panes/terminal/pty-mock"
import { PtyRegistry } from "../../src/tui/panes/terminal/registry"
import { toTaskId } from "../../src/types/task"
import { renderComponent, settle } from "./harness"

const REPO = "/repos/rove"

function issue(id: number, over: Record<string, unknown> = {}) {
  return { id, title: `story-${id}`, status: "open", created: "2026-08-01", body: "", ...over }
}

test("kanban: a rejected detail-drawer edit shows an error toast, not the stale card", async () => {
  const orch = {
    listTasks: () => [{ repo: REPO }],
    listIssues: async () => ({ repoRoot: REPO, exists: true, nextId: 9, issues: [issue(1)] }),
    activeTaskSignal: () => ({ get: () => null }),
    mutateIssue: async () => {
      throw new Error("issues store is read-only")
    },
  } as never
  const { frame, mockInput } = await renderComponent(
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
  // Open the only card's detail drawer, edit the title, save-and-close (esc).
  mockInput.pressArrow("down")
  await settle()
  mockInput.pressEnter()
  await settle(300)
  expect(await frame()).toContain("TITLE")
  // A startable story opens focused on WORKSPACE (see issue-detail-dialog's
  // initial `field`); the field ring is title→description→engine→workspace→
  // jump, so two tabs wrap around onto the title input.
  mockInput.pressTab()
  await settle()
  mockInput.pressTab()
  await settle()
  mockInput.typeText("-edited")
  await settle(150)
  expect(await frame()).toContain("story-1-edited")
  mockInput.pressEscape()
  await settle(400)
  const text = await frame()
  // The board repainted from the store, so the card still reads `story-1`.
  // Without the toast that is the ONLY thing on screen — and it looks exactly
  // like an edit that was never made.
  expect(text).toContain("✕")
  expect(text).toContain("Couldn't save story #1")
})

/**
 * The terminal's acquire-failure state must not be a dead end.
 *
 * `terminal.exited` names its recovery key ("process exited — F5 restarts
 * it"), and F5 is documented as THE terminal recovery chord. But a
 * `requestReset` that begins `if (!pty) return` does nothing after a failed
 * acquire, which runs `setPty(null)` — so in the one state that most needs
 * recovery, F5 is dead. The only escape is switching tasks away and back, which
 * the screen never mentioned.
 *
 * This drives the real chord through the real pane against a registry whose
 * first spawn throws, and asserts BOTH halves: the hint naming F5 is on
 * screen, and pressing F5 actually brings the terminal up.
 */
test("terminal: F5 recovers a failed acquire, and the pane says so", async () => {
  let attempt = 0
  // First spawn throws (the shell is missing); the retry succeeds and the
  // shell prints. A real PtyRegistry wraps it, so acquire/reset run for real.
  const registry = new PtyRegistry((opts) => {
    attempt += 1
    if (attempt === 1) throw new Error("spawn /bin/nope ENOENT")
    const pty = new MockTaskPty(opts)
    pty.feed("recovered-shell-prompt$ ")
    return pty
  })

  const { frame, mockInput } = await renderComponent(
    <Terminal taskId="t1" cwd="/repos/rove" focused={true} registry={registry} />,
    { width: 80, height: 16, providers: { dialog: true, kv: true, notifications: true } },
  )
  await settle(200)

  // BEFORE the key: the failure is stated AND the way out is named. Without
  // the hint the user has no reason to believe any key would help.
  const failed = await frame()
  expect(failed).toContain("terminal unavailable")
  expect(failed).toContain("F5")
  expect(failed).not.toContain("recovered-shell-prompt")

  // mockInput speaks raw bytes; F5 is CSI 15~.
  mockInput.pressKey("\x1b[15~")
  await settle(400)

  // AFTER: a real shell is up. Asserting the hint alone would have passed
  // against the broken guard — the recovered contents are the actual proof.
  const recovered = await frame()
  expect(recovered).toContain("recovered-shell-prompt")
  expect(recovered).not.toContain("terminal unavailable")
  expect(attempt).toBe(2)
})

/**
 * Enter on a task whose worktree can't be materialized must not be a TOTAL
 * no-op. `activateWorkspaceTask` correctly refuses to move the selection and
 * calls `reportError`; wiring `reportError` to a bare `console.error` sends it
 * to the daemon log only under the alternate screen, so the row does not move,
 * no toast appears, and the user can press Enter forever with identical
 * results.
 *
 * The unit tests next door cover the error→copy MAPPING. This one covers the
 * WIRING — that the mapped string actually reaches the toast surface.
 * Reverting either half must fail something; a mapping-only suite would pass.
 */
function SelectionHarness(props: { orch: never; notifyError: (m: string) => void }) {
  const selection = useWorkspaceSelection({
    orch: props.orch,
    tasks: [
      {
        id: toTaskId("t1"),
        title: "story task",
        repo: "/repos/rove",
        branch: "feat/x",
        // No worktreePath: activation must go through `ensureWorktree`.
        worktreePath: "",
        kind: "task",
        status: "backlog",
        pinned: false,
        vendor: "claude",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    activeTaskId: null,
    focusWorkspace: () => {},
    kv: { store: {}, set: () => {} },
    notifyError: props.notifyError,
  })
  // Fire the refusal once on mount — re-running on every `selection` identity
  // change would just repeat the same rejected activation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design.
  useEffect(() => {
    void selection.activateTask("t1")
  }, [])
  return <text>workspace</text>
}

test("workspace: Enter on an unmaterializable task raises a toast, not just a log line", async () => {
  const orch = {
    activeTaskSignal: () => () => null,
    setActiveTask: async () => {},
    reportUiEvent: () => {},
    ensureWorktree: async () => {
      throw new Error("fatal: not a git repository (or any of the parent directories): .git")
    },
  } as never

  function Harness() {
    const notif = useNotifications()
    return (
      <SelectionHarness
        orch={orch}
        notifyError={(message) => notif.notify({ kind: "error", taskId: "", tabId: "", title: message })}
      />
    )
  }

  const { frame } = await renderComponent(
    <>
      <Harness />
      <ToastOverlay />
    </>,
    { width: 100, height: 20, providers: { dialog: true, kv: true, notifications: true } },
  )
  await settle(300)

  const text = await frame()
  expect(text).toContain("✕")
  // The actionable non-git copy, not the generic worktree failure.
  expect(text).toContain("isn't a git repo yet")
})
