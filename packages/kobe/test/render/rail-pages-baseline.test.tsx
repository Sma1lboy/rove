/** @jsxImportSource @opentui/react */
/**
 * Rail-page visual baseline: Kanban / Routines / Issues swap the SAME
 * content panel, so switching between them must not move the text. The
 * 2026-08-30 visual audit found the three pages each picked their own left
 * inset (padding 1 / 2 / 3, so the body jumped sideways on every switch)
 * and two of the three painted their static page titles with the accent
 * hue, which on the default claude palette IS the focus orange.
 *
 * Contract pinned here, against the real render:
 *   - every rail page's content starts at exactly x=2 (the inset the other
 *     sibling pages — Versions / Worktrees — already used, so unifying on it
 *     changes the fewest surfaces);
 *   - every rail page title renders in `theme.text`, never an accent slot.
 */

import { expect, test } from "bun:test"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { createStateCell } from "../../src/lib/external-store"
import { type HostPageDeps, renderContentPage } from "../../src/tui-react/workspace/host-pages"
import type { Task } from "../../src/types/task"
import { renderComponent } from "./harness"

process.env.KOBE_HOME_DIR ??= (await import("node:fs")).mkdtempSync("/tmp/kobe-rail-baseline-")

// claude theme (the render-track default) — pinned as ints so a theme edit
// fails here loudly instead of silently re-breaking the palette contract.
const TEXT_RGB: readonly [number, number, number, number] = [234, 231, 223, 255]

const SELECTED_TASK = { id: "t1", repo: "/x/kobe" } as unknown as Task
const ONLINE = createStateCell("online")

function fakeOrchestrator(): RemoteOrchestrator {
  return {
    listTasks: () => [SELECTED_TASK],
    listAutomations: async () => ({ automations: [], keepsDaemonAlive: false }),
    automationRuns: async () => ({ runs: [] }),
    listIssues: async () => ({ repoRoot: "/x/kobe", exists: true, nextId: 99, issues: [] }),
    listWorkItems: async () => ({ items: [] }),
    connectionStateSignal: () => ONLINE,
    activeTaskSignal: () => ({ get: () => null }),
  } as unknown as RemoteOrchestrator
}

function deps(overrides: Partial<HostPageDeps>): HostPageDeps {
  return {
    orchestrator: fakeOrchestrator(),
    selectedTask: SELECTED_TASK,
    worktreesOpen: false,
    automationsOpen: false,
    workItemsOpen: false,
    kanbanOpen: false,
    updateOpen: false,
    closeWorktrees: () => {},
    closeAutomations: () => {},
    closeWorkItems: () => {},
    closeKanban: () => {},
    closeUpdate: () => {},
    activateTask: () => {},
    contentFocused: true,
    startIssueChat: async () => {},
    engineStates: new Map(),
    ...overrides,
  }
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 120))

async function renderPage(title: string, overrides: Partial<HostPageDeps>) {
  const { frame, spans } = await renderComponent(<box>{renderContentPage(deps(overrides))}</box>, {
    width: 80,
    height: 24,
    providers: { dialog: true, kv: true, notifications: true },
  })
  await settle()
  const text = await frame()
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
  { title: "Kanban", body: ["kobe", "┌"], overrides: { kanbanOpen: true } },
  { title: "ROUTINES", body: ["No routines scheduled."], overrides: { automationsOpen: true } },
  { title: "ISSUES", body: ["No open issues."], overrides: { workItemsOpen: true } },
]

for (const page of RAIL_PAGES) {
  test(`rail page ${page.title} starts its title at x=2`, async () => {
    const { line } = await renderPage(page.title, page.overrides)
    // Exactly two leading cells before the title — the shared inset. The old
    // per-page choices were 1 (Issues), 2 (Routines), 3 (Kanban), and the
    // whole body jumped sideways on every page switch.
    expect(line.startsWith(`  ${page.title}`)).toBe(true)
  })

  test(`rail page ${page.title} paints its title in theme.text`, async () => {
    const { titleSpan } = await renderPage(page.title, page.overrides)
    expect(titleSpan.fg).toBeDefined()
    // Never the accent/focus hue: a static page title is not focus, not
    // selection. On the default claude theme accent === focusAccent
    // (#CC785C), so an accent-colored title read as a second focus signal.
    expect(titleSpan.fg?.toInts()).toEqual([...TEXT_RGB])
  })

  test(`rail page ${page.title} starts its BODY at x=2 too`, async () => {
    // The title row alone is not the contract — a page can pad its root to 2
    // and still inset its own body children (Kanban's project selector and
    // board each carried their own paddingLeft). Pin every content region,
    // so a partial revert of the per-child insets fails here.
    const { text } = await renderPage(page.title, page.overrides)
    for (const anchor of page.body) {
      const line = text.split("\n").find((l) => l.includes(anchor))
      expect(line).toBeDefined()
      expect(line).toMatch(/^ {2}\S/)
    }
  })
}
