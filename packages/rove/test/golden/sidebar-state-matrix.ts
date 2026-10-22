/**
 * The sidebar's state vocabulary, enumerated.
 *
 * `buildSidebarRowView` is the single place that decides what a sidebar row
 * SAYS from the daemon's row status (`row.status`): which status glyph it
 * wears, which tone colours it, whether it animates, and what its subtitle
 * reads. The STATUS is the daemon's to decide (`rove-daemon/.../row-status.ts`
 * has its own precedence tests); this pins the mapping from every status the
 * daemon can send to what the TUI draws, plus the subtitle ladder (deletion
 * outranks a materializing job, which outranks the branch) that is still the
 * row's own.
 *
 * So this module renders the WHOLE input space to text. It owns no
 * assertions: it produces the canonical rows, and `sidebar-row-state.test.ts`
 * locks them against the committed golden.
 *
 * Keeping it separate from the test file is what lets the enumeration stay
 * exhaustive without the test file outgrowing the size cap, and it means the
 * matrix can be printed by hand (`bun test/golden/sidebar-state-matrix.ts`)
 * while investigating a diff.
 */

import { DEFAULT_SPINNER_FRAMES } from "@/engine/spinner-frames"
import type { SidebarRowView } from "@/tui/panes/sidebar/row-view"
import { buildSidebarRowView, rowIsLoading, withSpinnerFrame } from "@/tui/panes/sidebar/row-view"
import { tabRowActivity } from "@/tui/panes/sidebar/tree-core"
import { truncateBranchLabel } from "@/tui/panes/sidebar/view-core"
import { type Task, type TaskDeletionPhase, type TaskStatus, toTaskId } from "@/types/task"
import { BUILTIN_VENDORS } from "@/types/vendor"
import type { RowStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import { pad } from "./golden-file"

/** Fixed instant every `since` in the matrix is expressed against, so the
 *  golden never depends on when it ran. */
export const NOW = 1_760_000_000_000

/** Wide enough that nothing in the matrix truncates by accident, so a
 *  truncation in the golden is a real one. The dedicated budget block below
 *  exercises the narrow end on purpose. */
const SUBTITLE_BUDGET = 32

const BRANCH = "feat/sidebar"

/** A non-builtin engine id — the "no transcript store to watch" branch. */
const CUSTOM_VENDOR = "my-engine"

/** Every status the daemon can send, by name. `-` (no record at all) is a
 *  real, distinct INPUT: it must rest at the same quiet `○` as `idle`. */
const STATUSES: ReadonlyArray<readonly [string, RowStatus | undefined]> = [
  ["-", undefined],
  ["idle", { kind: "idle", since: NOW }],
  ["idle/turn_complete", { kind: "idle", since: NOW, state: "turn_complete" }],
  ["unseen", { kind: "unseen", since: NOW, state: "turn_complete" }],
  ["running", { kind: "running", since: NOW, state: "running" }],
  ["needs-input", { kind: "needs-input", since: NOW, state: "permission_needed" }],
  ["attention/rate_limited", { kind: "attention", reason: "rate_limited", since: NOW, state: "rate_limited" }],
  ["attention/error", { kind: "attention", reason: "error", since: NOW, state: "error" }],
  ["attention/dead", { kind: "attention", reason: "dead", since: NOW, state: "dead" }],
  ["attention/restored", { kind: "attention", reason: "restored", since: 0 }],
  ["attention/delete_failed", { kind: "attention", reason: "delete_failed", since: NOW }],
  ["busy/job", { kind: "busy", reason: "job", since: NOW }],
  ["busy/deleting", { kind: "busy", reason: "deleting", since: NOW }],
]

const statusNamed = (name: string): RowStatus | undefined => STATUSES.find(([n]) => n === name)?.[1]

const DELETION_PHASES = [undefined, "queued", "running", "error"] as const

// `TaskDeletionPhase` is a bare type union with no runtime array to spread, so
// the list above is hand-maintained. This makes that safe: adding a member
// upstream without extending DELETION_PHASES stops compiling here.
type _DeletionPhasesExhaustive = Exclude<TaskDeletionPhase, (typeof DELETION_PHASES)[number]> extends never
  ? true
  : ["DELETION_PHASES is missing a TaskDeletionPhase member"]
const _deletionPhasesExhaustive: _DeletionPhasesExhaustive = true
void _deletionPhasesExhaustive

/** Vendor-specific subtitles and spinner frames are recorded separately. */
const VENDORS: readonly string[] = [...BUILTIN_VENDORS, CUSTOM_VENDOR]

export function task(over: Partial<Task> = {}): Task {
  return {
    id: toTaskId("01JCTASKTASKTASKTASKTASK"),
    title: "fix the sidebar",
    repo: "/repos/rove",
    branch: BRANCH,
    worktreePath: "/wt/sidebar",
    kind: "task",
    status: "in_progress",
    pinned: false,
    vendor: "claude",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as Task
}

/**
 * Every scalar field of `SidebarRowView`, in the order the golden prints them.
 *
 * Hand-picking a subset is how a golden quietly reintroduces the sampling
 * problem it exists to remove: recording only glyph/tone/loading/subtitle
 * lets `isMain`, `titleText` and `materializing` (which selects the sweep bar
 * over the shimmer) all regress without moving a single line.
 * {@link RECORDED_FIELDS} is therefore checked
 * against the real object's keys by the test — adding a field to the interface
 * fails loudly until someone decides where it belongs.
 *
 * `spinnerFrames` is the one deliberate omission: it is constant per vendor and
 * printed in full by {@link spinnerBlock}, so repeating it on every status row
 * would be noise, not coverage.
 */
export const RECORDED_FIELDS = [
  "isMain",
  "titleText",
  "stateGlyph",
  "tone",
  "loading",
  "materializing",
  "subtitleText",
] as const

export const OMITTED_FIELDS = ["spinnerFrames"] as const

/** One row of the golden, in fixed columns so a diff points at the field that
 *  moved rather than reflowing the whole line. */
function row(inputs: readonly string[], view: SidebarRowView): string {
  const cells = [
    `main=${view.isMain ? 1 : 0}`,
    pad(`title=${view.titleText}`, 22),
    pad(`glyph=${view.stateGlyph}`, 9),
    pad(`tone=${view.tone}`, 16),
    `load=${view.loading ? 1 : 0}`,
    `matz=${view.materializing ? 1 : 0}`,
    `sub=${view.subtitleText}`,
  ]
  return `${inputs.join(" ")} | ${cells.join(" ")}`
}

function build(opts: {
  task: Task
  status?: RowStatus
  lifecycle?: { subagents: number }
  spinnerFrame?: number
  mainBranch?: string
  subtitleBudget?: number
}) {
  return buildSidebarRowView({
    task: opts.task,
    status: opts.status,
    lifecycle: opts.lifecycle,
    spinnerFrame: opts.spinnerFrame ?? 0,
    subtitleBudget: opts.subtitleBudget ?? SUBTITLE_BUDGET,
    truncateBranch: truncateBranchLabel,
    mainBranch: opts.mainBranch,
  })
}

/**
 * Every daemon status crossed with the task's deletion phase (the one task
 * fact the row still reads itself, for its subtitle word).
 *
 * Not a sampled selection: every combination is emitted, so a change that
 * reorders two rungs shows up as a block of moved lines instead of hiding in
 * whichever combination nobody wrote a case for.
 */
export function statusCrossProduct(): string[] {
  const lines: string[] = []
  const vendor = "claude"
  for (const [name, status] of STATUSES) {
    for (const deletion of DELETION_PHASES) {
      const subject = task({
        vendor,
        deletion:
          deletion === undefined
            ? undefined
            : { phase: deletion, force: false, requestedAt: "2026-01-01T00:00:00.000Z" },
      })
      const view = build({ task: subject, status })
      lines.push(row([pad(`status=${name}`, 30), pad(`del=${deletion ?? "-"}`, 12), pad(`vendor=${vendor}`, 17)], view))
    }
  }
  return lines
}

/** Only the subtitle depends on vendor identity; spinnerBlock records the frame sets. */
export function vendorBlock(): string[] {
  return VENDORS.map((vendor) => {
    const subtitles = ["-", "idle", "running"] as const
    return `${pad(`vendor=${vendor}`, 17)} ${subtitles
      .map((name) => {
        const view = build({ task: task({ vendor }), status: statusNamed(name) })
        return `${name === "-" ? "absent" : name}=${view.subtitleText}`
      })
      .join(" | ")}`
  })
}

/** A project (`main`) row resolves its branch from the repo checkout, not from
 *  `task.branch` — and falls back to a neutral dash when the caller has none. */
export function mainRowBlock(): string[] {
  const lines: string[] = []
  for (const mainBranch of ["main", "feat/long-running-branch", ""]) {
    for (const [name, status] of STATUSES) {
      const view = build({
        task: task({ kind: "main", branch: "", title: "rove" }),
        status,
        mainBranch,
      })
      lines.push(row([pad(`mainBranch=${mainBranch || "-"}`, 34), pad(`status=${name}`, 30)], view))
    }
  }
  return lines
}

/**
 * The animating glyph is engine-owned (`registry.spinnerFrames`), so the frame
 * set is part of the contract — and every frame in every set must stay visually
 * distinct from the settled badges, or a RUNNING row reads as a finished one.
 */
export function spinnerBlock(): string[] {
  const lines: string[] = []
  for (const vendor of VENDORS) {
    const frames: string[] = []
    // Two full cycles plus an out-of-range index: the modulo wrap is the part
    // that silently breaks when a frame set changes length.
    for (let frame = 0; frame < 26; frame++) {
      const view = build({
        task: task({ vendor: vendor as Task["vendor"] }),
        status: statusNamed("running"),
        spinnerFrame: frame,
      })
      frames.push(view.stateGlyph)
    }
    lines.push(`${pad(`vendor=${vendor}`, 17)} frames(0..25)=${frames.join("")}`)
  }
  // `withSpinnerFrame` overlays the live frame onto a view built at frame 0.
  // Its identity contract (an idle view is returned UNCHANGED, and the frame
  // accessor is never even read) is what keeps an idle row off the 10Hz tick.
  //
  // `sameAsDirect` is the part a glyph column alone would miss: the overlay
  // must reproduce EXACTLY what `buildSidebarRowView` would have returned with
  // that frame — every field, not just the one it rewrites. A divergence in
  // tone or subtitle between the two paths means an animating row and a
  // freshly-built one disagree about the same state.
  for (const [name, status] of STATUSES) {
    // Frame 0 reproduces the view it was built with (identity must survive);
    // 3 is an ordinary live frame; a frame past the set's length must wrap
    // rather than blank the glyph.
    for (const frame of [0, 3, 14, 99]) {
      const base = build({ task: task(), status })
      let reads = 0
      const overlaid = withSpinnerFrame(base, () => {
        reads++
        return frame
      })
      const direct = build({ task: task(), status, spinnerFrame: frame })
      const sameAsDirect = RECORDED_FIELDS.every((field) => overlaid[field] === direct[field])
      lines.push(
        `${pad(`status=${name}`, 30)} ${pad(`frame=${frame}`, 10)} overlay: base=${base.stateGlyph} after=${
          overlaid.stateGlyph
        } ${pad(`tone=${overlaid.tone}`, 16)} ${pad(`sub=${overlaid.subtitleText}`, 20)} frameReads=${reads} sameObject=${
          overlaid === base ? 1 : 0
        } sameAsDirect=${sameAsDirect ? 1 : 0}`,
      )
    }
  }
  lines.push(`defaultFrames=${DEFAULT_SPINNER_FRAMES.join("")}`)
  return lines
}

/**
 * Persisted board lifecycle (`TaskStatus`) crossed with the daemon's status.
 *
 * The row is a RUNTIME projection: `status` is user-driven and must never
 * reach it, so every column here should be identical down the `status` axis
 * and vary only with `row`. Written as a golden block rather than left to the
 * collapse assertion in `sidebar-row-view.test.ts` because that one only
 * proves the collapse with no status — the case this block adds back is
 * "a `done` task whose engine is asking for permission still shows `?`".
 */
export function statusVsActivityBlock(): string[] {
  const statuses: readonly TaskStatus[] = ["backlog", "in_progress", "in_review", "done", "canceled", "error"]
  const lines: string[] = []
  for (const status of statuses) {
    for (const [name, rowStatus] of STATUSES) {
      const view = build({ task: task({ status }), status: rowStatus })
      lines.push(row([pad(`status=${status}`, 20), pad(`row=${name}`, 30)], view))
    }
  }
  return lines
}

/**
 * `rowIsLoading` is the predicate the pane-level spinner gate is built on: it
 * must agree with the view's own `loading` for every status, or a
 * genuinely-working row freezes mid-animation.
 */
export function loadingAgreementBlock(): string[] {
  return STATUSES.map(([name, status]) => {
    const view = build({ task: task(), status })
    return `${pad(`status=${name}`, 30)} rowIsLoading=${rowIsLoading(status) ? 1 : 0} viewLoading=${view.loading ? 1 : 0}`
  })
}

/** Subagent marks ride as a `◇N` prefix — and ONLY while the row animates, so
 *  a mark whose end event never arrived can never caption a quiet row. */
export function subagentBlock(): string[] {
  const lines: string[] = []
  for (const subagents of [0, 1, 3, 12]) {
    for (const [name, status] of STATUSES) {
      for (const branch of [BRANCH, ""]) {
        const view = build({
          task: task({ branch }),
          status,
          lifecycle: { subagents },
        })
        lines.push(
          row([pad(`subagents=${subagents}`, 14), pad(`status=${name}`, 30), pad(`branch=${branch || "-"}`, 20)], view),
        )
      }
    }
  }
  return lines
}

/** Subtitle truncation is the row's only defence against a long branch pushing
 *  the right-edge cluster off the rail. */
export function subtitleBudgetBlock(): string[] {
  const lines: string[] = []
  const branch = "feature/a-very-long-branch-name-indeed"
  for (const budget of [0, 1, 4, 8, 16, 24, 40]) {
    for (const name of ["-", "running", "attention/rate_limited", "attention/error"] as const) {
      const view = build({ task: task({ branch }), status: statusNamed(name), subtitleBudget: budget })
      lines.push(row([pad(`budget=${budget}`, 11), pad(`status=${name}`, 30)], view))
    }
  }
  return lines
}

/**
 * Which activity entry a TAB row is allowed to read (its landing pulse).
 *
 * Neither selection nor a task rollup may supply missing tab identity.
 */
export function tabActivityBlock(): string[] {
  const lines: string[] = []
  for (const tabActivity of [undefined, "TAB"]) {
    for (const reportedTabCount of [0, 1, 2]) {
      for (const active of [false, true]) {
        const picked = tabRowActivity({
          tabId: "own",
          tabActivities: new Map([
            ...Array.from({ length: reportedTabCount }, (_, i): [string, string] => [`sibling-${i}`, "SIBLING"]),
            ...(tabActivity ? [["own", tabActivity] as [string, string]] : []),
          ]),
          ...{ taskActivity: "ROLLUP", active },
        })
        lines.push(
          `${pad(`tabActivity=${tabActivity ?? "-"}`, 20)} ${pad(`reported=${reportedTabCount}`, 12)} ${pad(
            `active=${active ? 1 : 0}`,
            10,
          )} -> ${picked ?? "<none>"}`,
        )
      }
    }
  }
  // With no rollup either there is nothing to fall back to — the tab row
  // rests at the shared no-state dot.
  for (const active of [false, true]) {
    const picked = tabRowActivity({ tabId: "own", tabActivities: undefined, ...{ taskActivity: undefined, active } })
    lines.push(
      `${pad("tabActivity=-", 20)} ${pad("reported=0", 12)} ${pad(`active=${active ? 1 : 0}`, 10)} taskActivity=- -> ${
        picked ?? "<none>"
      }`,
    )
  }
  return lines
}
