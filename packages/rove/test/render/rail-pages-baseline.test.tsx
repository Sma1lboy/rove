/** @jsxImportSource @opentui/react */
/**
 * Rail-page visual baseline: Kanban / Routines / Issues swap the SAME
 * content panel, so switching between them must not move the text. Left to
 * themselves the three pages each pick their own inset (padding 1 / 2 / 3, so
 * the body jumps sideways on every switch) and paint their static page titles
 * with the accent hue, which on the default claude palette IS the focus
 * orange.
 *
 * Contract pinned here, against the real render:
 *   - every rail page's content starts at exactly x=2 (the inset the other
 *     sibling pages — Versions / Worktrees — already used, so unifying on it
 *     changes the fewest surfaces);
 *   - every rail page title renders in `theme.text`, never an accent slot.
 */

import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { createStateCell } from "../../src/lib/external-store"
import { pageEntries } from "../../src/tui-react/pages/registry"
import { type HostPageDeps, renderContentPage } from "../../src/tui-react/workspace/host-pages"
import type { Task } from "../../src/types/task"
import { renderComponent, waitForFrameText } from "./harness"

let previousHome: string | undefined
beforeAll(() => {
  previousHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-rail-baseline-"))
})
afterAll(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = previousHome
})

// claude theme (the render-track default) — pinned as ints so a theme edit
// fails here loudly instead of silently re-breaking the palette contract.
const TEXT_RGB: readonly [number, number, number, number] = [234, 231, 223, 255]

const SELECTED_TASK = { id: "t1", repo: "/x/rove" } as unknown as Task
const ONLINE = createStateCell("online")

function fakeOrchestrator(): RemoteOrchestrator {
  return {
    listTasks: () => [SELECTED_TASK],
    listAutomations: async () => ({ automations: [], keepsDaemonAlive: false }),
    automationRuns: async () => ({ runs: [] }),
    listIssueRepos: async () => ["/x/rove"],
    listIssues: async () => ({ repoRoot: "/x/rove", exists: true, nextId: 99, issues: [] }),
    listWorkItems: async () => ({ items: [] }),
    connectionStateSignal: () => ONLINE,
    activeTaskSignal: () => ({ get: () => null }),
  } as unknown as RemoteOrchestrator
}

function deps(overrides: Partial<HostPageDeps>): HostPageDeps {
  return {
    orchestrator: fakeOrchestrator(),
    selectedTask: SELECTED_TASK,
    nav: "terminal",
    pages: pageEntries(),
    worktreesOpen: false,
    updateOpen: false,
    closeWorktrees: () => {},
    closePage: () => {},
    closeUpdate: () => {},
    activateTask: () => {},
    contentFocused: true,
    engineStates: new Map(),
    ...overrides,
  }
}

/** Render a page and wait until `ready` (its async body) has drawn. */
async function renderPage(title: string, overrides: Partial<HostPageDeps>, ready: string) {
  const { frame, spans } = await renderComponent(<box>{renderContentPage(deps(overrides))}</box>, {
    width: 80,
    height: 24,
    providers: { dialog: true, kv: true, notifications: true },
  })
  const text = await waitForFrameText(frame, ready)
  const line = text.split("\n").find((l) => l.includes(title))
  expect(line).toBeDefined()
  const titleSpan = (await spans()).lines.flatMap((l) => l.spans).find((span) => span.text.includes(title))
  expect(titleSpan).toBeDefined()
  return { text, line: line as string, titleSpan: titleSpan as NonNullable<typeof titleSpan> }
}

type RailPage = {
  title: string
  /** EVERY distinctive content region below the title row. The title alone
   *  would pass even if the body kept its own old inset, which is exactly
   *  the sideways jump this file exists to prevent — and Kanban has two
   *  independently-padded body children (project selector, board), so both
   *  are anchored. */
  body: readonly string[]
  overrides: Partial<HostPageDeps>
}

const RAIL_PAGES: readonly RailPage[] = [
  // `╭` anchors the board's first column — its rounded corner, matching every
  // other framed surface (see kanban-columns.test.tsx, which pins the style).
  { title: "Kanban", body: ["rove", "╭"], overrides: { nav: "kanban.board" } },
  { title: "ROUTINES", body: ["No routines scheduled."], overrides: { nav: "automations" } },
  { title: "ISSUES", body: ["No open issues."], overrides: { nav: "issues.github" } },
]

for (const page of RAIL_PAGES) {
  test(`rail page ${page.title} paints its title in theme.text`, async () => {
    const { titleSpan } = await renderPage(page.title, page.overrides, page.body.at(-1)!)
    expect(titleSpan.fg).toBeDefined()
    // Never the accent/focus hue: a static page title is not focus, not
    // selection. On the default claude theme accent === focusAccent
    // (#CC785C), so an accent-colored title read as a second focus signal.
    expect(titleSpan.fg?.toInts()).toEqual([...TEXT_RGB])
  })

  test(`rail page ${page.title} starts its title and BODY at x=2`, async () => {
    // Per-page insets (1 / 2 / 3) made the body jump sideways on every page
    // switch. The title row alone is not the contract — a page can pad its
    // root to 2 and still inset its own body children (Kanban's project
    // selector and board each carry their own paddingLeft), so pin both.
    const { text, line: titleLine } = await renderPage(page.title, page.overrides, page.body.at(-1)!)
    expect(titleLine.startsWith(`  ${page.title}`)).toBe(true)
    // Each anchor's line, or the line itself when it does not start at x=2.
    const insets = page.body.map((anchor) => {
      const line = text.split("\n").find((l) => l.includes(anchor)) ?? `<${anchor} not on screen>`
      return /^ {2}\S/.test(line) ? "x=2" : line
    })
    expect(insets).toEqual(page.body.map(() => "x=2"))
  })
}
