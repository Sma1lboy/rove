/** @jsxImportSource @opentui/react */
/**
 * The sidebar scene catalog — every state of the rail worth locking a frame of.
 *
 * A scene is a fully-specified `SidebarTree` mount plus, optionally, the keys
 * to press before capturing. Keeping the catalog separate from the runner means
 * adding a state is a data edit, and the runner's compare logic never grows.
 *
 * Deliberately excluded from every scene: `kind: "main"` tasks. A project row
 * resolves its label by polling the repo's real git HEAD, so a frame containing
 * one would depend on the checkout the test happened to run against. That row's
 * own logic is locked exhaustively (and hermetically) by the pure state matrix
 * in `test/golden/sidebar-row-state.golden.txt` instead.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import type { TaskActivityState } from "@/engine/hook-events"
import { SidebarTree } from "@/tui-react/panes/sidebar/SidebarTree"
import { resetRowStatusForTests } from "@/tui-react/workspace/row-status-sync"
import { tabsByTask } from "@/tui-react/workspace/terminal-tabs-shared"
import type { MachineLayerEntry } from "@/tui/panes/sidebar/machine-layer"
import { type Task, toTaskId } from "@/types/task"
import type { RowStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import type { ReactNode } from "react"

/**
 * Every activity `at`, as a fixed AGE rather than a fixed instant: a working
 * or blocked task row prints how long it has been that way, so a hard-coded
 * epoch would render a number that grows by one every day and re-break these
 * goldens on a schedule.
 *
 * 22½ minutes renders `22m` and sits half a minute from either bucket edge,
 * so the whole scene sweep can straddle a wall-clock minute without flipping
 * the string. Read once at module load, so every scene shares one instant.
 */
const AT = Date.now() - (22 * 60 + 30) * 1000

export const SCENE_WIDTH = 30
export const SCENE_HEIGHT = 22

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repos/rove",
    branch: `feat/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    pinned: false,
    vendor: "claude",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  } as Task
}

const ALPHA = task("alpha")
const BRAVO = task("bravo")

/** A clean slate: the module-level tab map and daemon status outlive a scene. */
function resetScene(): void {
  tabsByTask.clear()
  resetRowStatusForTests()
}

function taskState(state: TaskActivityState): ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>> {
  return new Map([["alpha", new Map([["tab-1", { state, at: AT }]])]])
}

/** The standard tree, with the daemon reporting `status` for alpha and bravo at rest. */
function standardWith(status: RowStatus): () => void {
  return () => {
    resetScene()
    resetRowStatusForTests({
      alpha: { task: status, tabs: {} },
      bravo: { task: { kind: "idle", since: 0 }, tabs: {} },
    })
  }
}

export interface Scene {
  /** Golden file basename (`<name>.frame.txt`). */
  readonly name: string
  /** Why this frame is worth locking — printed into the golden's header. */
  readonly about: string
  /** Runs before mounting: seeds the module-level tab map and row status. */
  readonly setup: () => void
  readonly element: ReactNode
  /** Keys to type after mount, before capture. */
  readonly keys?: readonly string[]
  /**
   * The frame animates, so the spinner cell must be masked before comparing.
   * Only set on scenes whose other rows never wear a plain `·`, since the
   * mask would otherwise swallow it too.
   */
  readonly animated?: boolean
  /** Registered machines the sidebar reads during this scene; absent = none. */
  readonly machines?: readonly MachineLayerEntry[]
}

function tree(over: Partial<Parameters<typeof SidebarTree>[0]> = {}) {
  return (
    <SidebarTree
      tasks={[ALPHA, BRAVO]}
      selectedId="alpha"
      onSelect={() => {}}
      // Present so the labelled create row renders — its absence is a
      // different (host-less) chrome, and the rail's first affordance is
      // exactly the kind of thing a layout change quietly drops.
      onAddTask={() => {}}
      focused={true}
      width={SCENE_WIDTH}
      {...over}
    />
  )
}

/**
 * One repo checked out here, on a mac and on an offline vps (same `repoId`):
 * ONE project, every machine's task under it, the remote ones wearing a cloud.
 */
const REPO_ID = "github.com/sma1lboy/rove"
const MACHINES: readonly MachineLayerEntry[] = [
  { alias: "mac", hostLabel: "mac-mini", state: "online", version: "0.9.259" },
  { alias: "vps", hostLabel: "vps", state: "offline" },
]
const MERGED_TASKS = [
  task("alpha", { repoId: REPO_ID }),
  task("charlie", { repoId: REPO_ID, repo: "/Users/n/rove", origin: { machineId: "mac", hostLabel: "mac-mini" } }),
  task("delta", {
    repoId: REPO_ID,
    repo: "/srv/rove",
    origin: { machineId: "vps", hostLabel: "vps", stale: true },
  }),
  task("echo", { repo: "/repos/api" }),
]

/** A lineage five generations deep, to show the indent stopping and the level number taking over. */
const CHILD_TASKS = [
  ALPHA,
  task("c-shared", {
    title: "check types",
    parentTaskId: ALPHA.id,
    sharesWorkspaceOf: ALPHA.id,
  }),
  task("c-own", { title: "port tree builder", parentTaskId: ALPHA.id }),
  task("g-own", { title: "wire fold glyph", parentTaskId: toTaskId("c-own") }),
  task("gg-own", { title: "cover depth cap", parentTaskId: toTaskId("g-own") }),
  task("ggg-own", { title: "fifth generation", parentTaskId: toTaskId("gg-own") }),
  BRAVO,
]

const seedChildStatus = (): void => {
  resetScene()
  resetRowStatusForTests({
    alpha: { task: { kind: "idle", since: 0 }, tabs: {} },
    "c-shared": { task: { kind: "needs-input", since: AT, state: "permission_needed" }, tabs: {} },
    "c-own": { task: { kind: "running", since: AT, state: "running" }, tabs: {} },
  })
}

export const SCENES: readonly Scene[] = [
  {
    name: "machines-merged",
    about: "one repo on three machines is ONE project; no machine headers, remote rows wear a cloud (offline: warning)",
    setup: resetScene,
    machines: MACHINES,
    element: tree({ tasks: MERGED_TASKS }),
  },
  {
    name: "machines-remote-cursor",
    about: "the cursor on a remote row spells out where it lives: on <host> · <version or state>",
    setup: resetScene,
    machines: MACHINES,
    element: tree({ tasks: MERGED_TASKS, selectedId: "delta" }),
  },
  {
    name: "tree-unknown",
    about: "no daemon status at all — every task rests at the quiet glyph",
    setup: resetScene,
    element: tree(),
  },
  {
    name: "task-idle",
    about: "a KNOWN-idle task (the daemon reported it) wears the hollow circle, like its unreported siblings",
    setup: standardWith({ kind: "idle", since: AT, state: "idle" }),
    element: tree({ engineTabState: taskState("idle") }),
  },
  {
    name: "task-turn-complete",
    about: "unread completion lamp on the task that finished: the daemon says unseen",
    setup: standardWith({ kind: "unseen", since: AT, state: "turn_complete" }),
    element: tree({ engineTabState: taskState("turn_complete"), selectedId: "bravo" }),
  },
  {
    name: "task-permission-needed",
    about: "blocked on the user — the one state whose glyph literally asks a question",
    setup: standardWith({ kind: "needs-input", since: AT, state: "permission_needed" }),
    element: tree({ engineTabState: taskState("permission_needed") }),
  },
  {
    name: "task-rate-limited",
    about: "quota exhausted — an amber attention glyph, with how long it has been stuck",
    setup: standardWith({ kind: "attention", reason: "rate_limited", since: AT, state: "rate_limited" }),
    element: tree({ engineTabState: taskState("rate_limited") }),
  },
  {
    name: "task-error",
    about: "the engine reported a failed turn — a red attention glyph",
    setup: standardWith({ kind: "attention", reason: "error", since: AT, state: "error" }),
    element: tree({ engineTabState: taskState("error") }),
  },
  {
    name: "task-running",
    about: "a live turn — the glyph cell animates, so it is masked; everything AROUND it is still locked",
    setup: standardWith({ kind: "running", since: AT, state: "running" }),
    element: tree({ engineTabState: taskState("running") }),
    animated: true,
  },
  {
    name: "child-tasks",
    about:
      "children nest under their parent with a shared (⑂) or own-worktree (⎇) marker; the indent stops at three levels and deeper rows wear their level",
    setup: seedChildStatus,
    element: tree({ tasks: CHILD_TASKS }),
    animated: true,
  },
  {
    name: "worktree-pin-and-pr",
    about: "worktree-level facts share one right-edge cluster: pin, PR check chip, jump digit",
    setup: resetScene,
    element: tree({
      tasks: [
        task("alpha", { pinned: true, prStatus: { checkState: "passing" } as Task["prStatus"] }),
        task("bravo", { prStatus: { checkState: "failing" } as Task["prStatus"] }),
      ],
    }),
  },
  {
    name: "worktree-status-chip",
    about: "the board status never reaches the rail; only the PR chip does, and a conflict outranks green checks",
    setup: resetScene,
    element: tree({
      tasks: [
        // in_review beside a passing PR: the pair the agent protocol produces
        // (the engine sets in_review, CI reports the branch) and the one place
        // the two chips must stay readable side by side.
        task("review", { status: "in_review", prStatus: { checkState: "passing" } as Task["prStatus"] }),
        task("stuck", { prStatus: { checkState: "passing", mergeable: "CONFLICTING" } as Task["prStatus"] }),
        task("shipped", { status: "done" }),
        task("dropped", { status: "canceled" }),
        task("broke", { status: "error" }),
        task("quiet", { status: "backlog" }),
      ],
    }),
  },
  {
    name: "long-labels",
    about:
      "a clipped label ends in a visible … (never Yoga's bare hard cut), and the right-edge cluster still gets its cells",
    setup: resetScene,
    element: tree({
      tasks: [
        task("wordy", {
          title: "Restart the tab strip without losing scrollback",
          branch: "refactor/tab-strip-restart-scrollback",
          pinned: true,
          prStatus: { checkState: "passing" } as Task["prStatus"],
        }),
        ALPHA,
      ],
    }),
  },
  {
    name: "search-pruned",
    about: "the query row plus a tree pruned to matches and their ancestors — a hit never floats free",
    setup: resetScene,
    element: tree(),
    keys: ["/", "bravo"],
  },
  {
    name: "search-child-title",
    about: "the query reaches a child task's title and drags its parent along — a hit never floats free",
    setup: resetScene,
    element: tree({ tasks: CHILD_TASKS.slice(0, 3) }),
    keys: ["/", "types"],
  },
  {
    name: "move-mode",
    about: "scope-aware reorder mode (issue #43) — the dragged ROW wears the chip and j/k drag instead of walking",
    setup: resetScene,
    element: tree({ moveMode: true }),
  },
  {
    name: "recent-jump-row",
    about: "narrow mode's one-keystroke way back into the task you were last inside",
    setup: resetScene,
    element: tree({ recentTask: BRAVO }),
  },
  {
    name: "zen-chip",
    about: "the zen affordance sits below the tree body, not inside it",
    setup: resetScene,
    element: tree({ zenActive: true }),
  },
  {
    name: "scratch-flat",
    about: "a scratch task is one row under No project, whatever tabs it has (issue #41)",
    setup: resetScene,
    element: tree({
      tasks: [task("scratchy", { kind: "dir", scratch: true, repo: "/Users/me", branch: "" } as Partial<Task>), ALPHA],
    }),
  },
  {
    name: "scratch-path-label",
    about: "a scratch row is named by its tail-truncated path, never a stored auto-name (issue #42)",
    setup: resetScene,
    element: tree({
      tasks: [
        task("scratchy", {
          kind: "dir",
          scratch: true,
          title: "jacksonc-ab3x",
          repo: "/Users/me/deep/nested/project-dir",
          worktreePath: "/Users/me/deep/nested/project-dir",
          branch: "",
        } as Partial<Task>),
        ALPHA,
      ],
    }),
  },
  {
    name: "empty",
    about: "no tasks at all — the rail still renders its chrome rather than collapsing",
    setup: resetScene,
    element: tree({ tasks: [], selectedId: null }),
  },
]
