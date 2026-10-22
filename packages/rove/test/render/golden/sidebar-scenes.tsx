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
import type { TabsState } from "@/tui/workspace/terminal-tabs-core"
import { type Task, toTaskId } from "@/types/task"
import type { RowStatus, TabStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import type { ReactNode } from "react"

/**
 * Every activity `at`, as a fixed AGE rather than a fixed instant: a working
 * or blocked tab row prints how long it has been that way, so a hard-coded
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

/** Seed the module-level tab map the tree projects its child rows from. */
function seedTabs(
  entries: ReadonlyArray<{
    taskId: string
    tabs: ReadonlyArray<{ id: string; title: string; kind?: "engine" | "command" }>
  }>,
): void {
  tabsByTask.clear()
  // No daemon status unless a scene says so: the module-level copy outlives a scene.
  resetRowStatusForTests()
  for (const entry of entries) {
    tabsByTask.set(entry.taskId, {
      tabs: entry.tabs.map((tab, i) => ({
        kind: tab.kind ?? ("engine" as const),
        id: tab.id,
        title: tab.title,
        ordinal: i + 1,
        ...(tab.kind === "command" ? { command: ["bash"] } : {}),
      })),
      activeId: entry.tabs[0]?.id ?? "tab-1",
      nextOrdinal: entry.tabs.length + 1,
    } as TabsState)
  }
}

/** Two agent tabs on `alpha`, one on `bravo` — the standard tree shape. */
function seedStandard(): void {
  seedTabs([
    {
      taskId: "alpha",
      tabs: [
        { id: "tab-1", title: "build" },
        { id: "tab-2", title: "review" },
      ],
    },
    { taskId: "bravo", tabs: [{ id: "tab-1", title: "tests" }] },
  ])
}

function tabState(state: TaskActivityState): ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>> {
  return new Map([["alpha", new Map([["tab-1", { state, at: AT }]])]])
}

const SESSION = { alive: true, restored: false, tracked: true } as const

/** The daemon's row status (`row.status`) for alpha: `tabId` in `status`, its siblings idle. */
function seedStatus(status: RowStatus, tabId = "tab-1"): void {
  const idle: TabStatus = { kind: "idle", since: 0, ...SESSION }
  resetRowStatusForTests({
    alpha: {
      task: status,
      tabs: { "tab-1": idle, "tab-2": idle, [tabId]: { ...status, ...SESSION } },
    },
    bravo: { task: { kind: "idle", since: 0 }, tabs: { "tab-1": idle } },
  })
}

/** The standard tree, with the daemon reporting `status` for one of alpha's tabs. */
function standardWith(status: RowStatus, tabId?: string): () => void {
  return () => {
    seedStandard()
    seedStatus(status, tabId)
  }
}

export interface Scene {
  /** Golden file basename (`<name>.frame.txt`). */
  readonly name: string
  /** Why this frame is worth locking — printed into the golden's header. */
  readonly about: string
  /** Runs before mounting: seeds the module-level tab map. */
  readonly setup: () => void
  readonly element: ReactNode
  /** Keys to type after mount, before capture. */
  readonly keys?: readonly string[]
  /**
   * The frame animates, so the spinner cell must be masked before comparing.
   * Only set on scenes with NO non-agent tab, since the mask would otherwise
   * also swallow that row's plain `·`.
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
      selectedTabId="tab-1"
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
const seedMerged = () => seedTabs([{ taskId: "alpha", tabs: [{ id: "tab-1", title: "build" }] }])

export const SCENES: readonly Scene[] = [
  {
    name: "machines-merged",
    about: "one repo on three machines is ONE project; no machine headers, remote rows wear a cloud (offline: warning)",
    setup: seedMerged,
    machines: MACHINES,
    element: tree({ tasks: MERGED_TASKS }),
  },
  {
    name: "machines-remote-cursor",
    about: "the cursor on a remote row spells out where it lives: on <host> · <version or state>",
    setup: seedMerged,
    machines: MACHINES,
    element: tree({ tasks: MERGED_TASKS, selectedId: "delta", selectedTabId: null }),
  },
  {
    name: "tree-unknown",
    about: "no daemon status at all — every tab rests at the quiet glyph",
    setup: seedStandard,
    element: tree(),
  },
  {
    name: "tab-idle",
    about: "a KNOWN-idle tab (the daemon reported it) wears the hollow circle, like its unreported siblings",
    setup: standardWith({ kind: "idle", since: AT, state: "idle" }),
    element: tree({ engineTabState: tabState("idle") }),
  },
  {
    name: "tab-turn-complete",
    about: "unread completion lamp on the tab that finished: the daemon says unseen",
    setup: standardWith({ kind: "unseen", since: AT, state: "turn_complete" }),
    element: tree({ engineTabState: tabState("turn_complete"), selectedId: "bravo", selectedTabId: "tab-1" }),
  },
  {
    name: "tab-still-writing",
    about: "a sibling transcript cannot turn this completed tab back into a spinner",
    setup: standardWith({ kind: "unseen", since: AT, state: "turn_complete" }),
    element: tree({
      engineTabState: tabState("turn_complete"),
      selectedId: "bravo",
      selectedTabId: "tab-1",
      ...{ transcriptActivity: new Map([["/wt/alpha", { mtimeMs: AT + 60_000 }]]) },
    }),
    animated: true,
  },
  {
    name: "tab-permission-needed",
    about: "blocked on the user — the one state whose glyph literally asks a question",
    setup: standardWith({ kind: "needs-input", since: AT, state: "permission_needed" }),
    element: tree({ engineTabState: tabState("permission_needed") }),
  },
  {
    name: "tab-rate-limited",
    about: "quota exhausted — an amber attention glyph, with how long it has been stuck",
    setup: standardWith({ kind: "attention", reason: "rate_limited", since: AT, state: "rate_limited" }),
    element: tree({ engineTabState: tabState("rate_limited") }),
  },
  {
    name: "tab-error",
    about: "the engine reported a failed turn — a red attention glyph",
    setup: standardWith({ kind: "attention", reason: "error", since: AT, state: "error" }),
    element: tree({ engineTabState: tabState("error") }),
  },
  {
    name: "tab-running",
    about: "a live turn — the glyph cell animates, so it is masked; everything AROUND it is still locked",
    setup: standardWith({ kind: "running", since: AT, state: "running" }),
    element: tree({ engineTabState: tabState("running") }),
    animated: true,
  },
  {
    name: "tab-running-sibling",
    about: "work in a NON-active tab must light THAT row and leave the active one alone (the borrowed-spinner bug)",
    setup: standardWith({ kind: "running", since: AT, state: "running" }, "tab-2"),
    element: tree({
      engineTabState: new Map([["alpha", new Map([["tab-2", { state: "running" as const, at: AT }]])]]),
    }),
    animated: true,
  },
  {
    name: "tab-non-agent",
    about: "a shell/command tab is outside the state vocabulary entirely — plain dot, no circle",
    setup: () =>
      seedTabs([
        {
          taskId: "alpha",
          tabs: [
            { id: "tab-1", title: "build" },
            { id: "tab-2", title: "shell", kind: "command" },
          ],
        },
        { taskId: "bravo", tabs: [{ id: "tab-1", title: "tests" }] },
      ]),
    element: tree(),
  },
  {
    name: "worktree-pin-and-pr",
    about: "worktree-level facts share one right-edge cluster: pin, PR check chip, jump digit",
    setup: seedStandard,
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
    setup: () => seedTabs([]),
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
    setup: () =>
      seedTabs([
        {
          taskId: "wordy",
          tabs: [{ id: "tab-1", title: "persist scrollback across daemon restarts without dropping" }],
        },
        { taskId: "alpha", tabs: [{ id: "tab-1", title: "build" }] },
      ]),
    element: tree({
      tasks: [
        task("wordy", {
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
    setup: seedStandard,
    element: tree(),
    keys: ["/", "bravo"],
  },
  {
    name: "search-tab-title",
    about: "the query reaches a live TAB title and drags its worktree along — the tree's own increment",
    setup: seedStandard,
    element: tree(),
    keys: ["/", "review"],
  },
  {
    name: "move-mode",
    about: "scope-aware reorder mode (issue #43) — the dragged ROW wears the chip and j/k drag instead of walking",
    setup: seedStandard,
    element: tree({ moveMode: true }),
  },
  {
    name: "recent-jump-row",
    about: "narrow mode's one-keystroke way back into the task you were last inside",
    setup: seedStandard,
    element: tree({ recentTask: BRAVO }),
  },
  {
    name: "zen-chip",
    about: "the zen affordance sits below the tree body, not inside it",
    setup: seedStandard,
    element: tree({ zenActive: true }),
  },
  {
    name: "scratch-flat",
    about: "a scratch task renders no middle worktree row — its shell tab hangs directly under SCRATCH (issue #41)",
    setup: () =>
      seedTabs([
        { taskId: "scratchy", tabs: [{ id: "tab-1", title: "shell 1", kind: "command" }] },
        { taskId: "alpha", tabs: [{ id: "tab-1", title: "build" }] },
      ]),
    element: tree({
      tasks: [task("scratchy", { kind: "dir", scratch: true, repo: "/Users/me", branch: "" } as Partial<Task>), ALPHA],
    }),
  },
  {
    name: "scratch-path-label",
    about: "a scratch row with unknown tabs is named by its tail-truncated path, never a stored auto-name (issue #42)",
    setup: () => seedTabs([{ taskId: "alpha", tabs: [{ id: "tab-1", title: "build" }] }]),
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
    setup: () => tabsByTask.clear(),
    element: tree({ tasks: [], selectedId: null, selectedTabId: null }),
  },
]
