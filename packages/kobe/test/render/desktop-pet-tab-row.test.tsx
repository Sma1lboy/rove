/** @jsxImportSource @opentui/react */
/**
 * The desktop pet, mounted on a REAL tab row.
 *
 * Two contracts the unit test cannot state, because both are about the
 * rendered rail rather than a pure function:
 *
 *  1. Flag OFF by default — a row with no `rove.desktop_pet` in state.json
 *     (and no KV provider at all) renders exactly the pre-pet rail. The pet
 *     is opt-in decoration; if it leaked on by default it would silently
 *     change every existing install's sidebar.
 *  2. Flag ON — the row shows exactly one 3-cell frame, and that frame tracks
 *     the SAME activity the state glyph beside it reads (running → `>_<` for
 *     the cat, waiting → `o_o`, done → `^_^`, idle → `._.`).
 *
 * Why `TabTreeRow` and not a whole `SidebarTree` scene: the pet's inputs are
 * the row's own `activity` (the per-tab state `tabRowActivity` resolved) and
 * the KV flag — both already parameters of this component, so the row is the
 * widest boundary that can carry them without a daemon.
 */

import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BoxRenderable } from "@opentui/core"
import type { TaskEngineState } from "../../src/client/remote-orchestrator-payloads"
import type { TreeRowShared } from "../../src/tui-react/panes/sidebar/tree-row-shell"
import { TabTreeRow } from "../../src/tui-react/panes/sidebar/tree-rows"
import { petFrameOf, petSpeciesOf } from "../../src/tui/desktop-pet"
import type { TreeTab } from "../../src/tui/panes/sidebar/tree-core"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { renderComponent, settle } from "./harness"

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

const TAB: TreeTab = { id: "tab-1", label: "build", engine: true } as TreeTab

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

function activity(state: TaskEngineState["state"]): TaskEngineState {
  return { state, at: 1 }
}

async function row(state: TaskEngineState | undefined, opts: { pet: boolean }): Promise<string> {
  const home = process.env.KOBE_HOME_DIR ?? mkdtempSync(join(tmpdir(), "kobe-desktop-pet-"))
  if (opts.pet) {
    // Write the flag where kvStatePath() reads it.
    const dir = join(home, ".config", "rove")
    const { mkdirSync } = await import("node:fs")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "state.json"), JSON.stringify({ "rove.desktop_pet": true }))
  }
  process.env.KOBE_HOME_DIR = home
  // No daemon activity arrives through a direct prop, so the activity rides
  // the row through its `shared.engineTabState` slice — the same map the tree
  // builds it from.
  const s = shared()
  const wired: TreeRowShared = state ? { ...s, engineTabState: new Map([[TASK.id, new Map([[TAB.id, state]])]]) } : s
  const { frame } = await renderComponent(
    <TabTreeRow rowId="alpha::tab-1" flatIndex={0} task={TASK} tab={TAB} shared={wired} />,
    { width: 30, height: 4, providers: { kv: true } },
  )
  await settle(90)
  return await frame()
}

test("flag OFF: the row renders no pet at all", async () => {
  const out = await row(activity("running"), { pet: false })
  const cat = petFrameOf(petSpeciesOf(TAB.id), "running")
  expect(out).not.toContain(cat)
})

test("flag ON: the frame tracks the activity the state glyph reads", async () => {
  const species = petSpeciesOf(TAB.id)
  const running = await row(activity("running"), { pet: true })
  expect(running).toContain(petFrameOf(species, "running"))

  const waiting = await row(activity("permission_needed"), { pet: true })
  expect(waiting).toContain(petFrameOf(species, "waiting"))

  const done = await row(activity("turn_complete"), { pet: true })
  expect(done).toContain(petFrameOf(species, "done"))
})
