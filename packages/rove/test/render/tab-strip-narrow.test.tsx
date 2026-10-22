/** @jsxImportSource @opentui/react */
/**
 * Narrow condensed tab strip: below the breakpoint the
 * strip shows only the ACTIVE tab plus a `2/3` position counter — narrow
 * overrides the mode gate, because the sidebar tree is not on screen beside
 * a narrow workspace, so the condensed strip is the only tab affordance
 * there. Desktop rendering honours the configured mode (default `always`).
 */

import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TAB_STRIP_MODE_KEY } from "../../src/state/tab-strip"
import { resetRowStatusForTests } from "../../src/tui-react/workspace/row-status-sync"
import { TabStrip } from "../../src/tui-react/workspace/tab-strip"
import { DEFAULT_GLYPHS } from "../../src/tui/lib/glyphs"
import type { TerminalTab } from "../../src/tui/workspace/terminal-tabs-core"
import { renderComponent } from "./harness"

process.env.ROVE_HOME_DIR ??= mkdtempSync(join(tmpdir(), "rove-tab-strip-test-"))

const TABS: readonly TerminalTab[] = [
  { kind: "engine", id: "tab-1", title: null, ordinal: 1 },
  { kind: "engine", id: "tab-2", title: "a much longer engine tab title than fits", ordinal: 2 },
  { kind: "engine", id: "tab-3", title: null, ordinal: 3 },
]

const SESSION = { alive: true, restored: false, tracked: true } as const

/** The daemon's view (`row.status`): tab-2 runs, tab-3 errored. */
function seedStatus(): void {
  resetRowStatusForTests({
    alpha: {
      task: { kind: "attention", reason: "error", since: 1 },
      tabs: {
        "tab-2": { kind: "running", since: 1, state: "running", ...SESSION },
        "tab-3": { kind: "attention", reason: "error", since: 1, state: "error", ...SESSION },
      },
    },
  })
}

function strip(activeId: string) {
  seedStatus()
  return (
    <TabStrip
      taskId="alpha"
      tabs={TABS}
      activeId={activeId}
      onSelect={() => {}}
      vendor="claude"
      liveTitles={new Map()}
      turnVendors={new Map()}
    />
  )
}

test("narrow strip shows the active tab truncated with a position counter", async () => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-tab-strip-narrow-"))
  mkdirSync(join(process.env.ROVE_HOME_DIR, ".config", "rove"), { recursive: true })
  writeFileSync(
    join(process.env.ROVE_HOME_DIR, ".config", "rove", "state.json"),
    JSON.stringify({ [TAB_STRIP_MODE_KEY]: "always" }),
  )
  const { frame } = await renderComponent(strip("tab-2"), { width: 46, height: 4, providers: { kv: true } })
  const out = await frame()
  expect(out).toContain("2/3")
  // The long title is clipped with an ellipsis instead of wrapping.
  expect(out).toContain("…")
  expect(out).not.toContain("than fits")
})

test("desktop renders the boxed strip when the mode is `always`", async () => {
  // Explicit, because `never` is the default: the sidebar tree
  // already lists these tabs. This pins what the strip DRAWS when asked for.
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-tab-strip-always-"))
  mkdirSync(join(process.env.ROVE_HOME_DIR, ".config", "rove"), { recursive: true })
  writeFileSync(
    join(process.env.ROVE_HOME_DIR, ".config", "rove", "state.json"),
    JSON.stringify({ [TAB_STRIP_MODE_KEY]: "always" }),
  )
  const { frame } = await renderComponent(strip("tab-2"), { width: 100, height: 4, providers: { kv: true } })
  const out = await frame()
  // No `2/3` counter outside narrow mode, but the strip itself draws: every
  // tab is a bordered box, so the frame carries the rounded corners.
  expect(out).not.toContain("2/3")
  expect(out).toContain("╭")
  expect(out).toContain("a much longer engine tab title")
})

test("desktop honours a stored `never`", async () => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-tab-strip-never-"))
  mkdirSync(join(process.env.ROVE_HOME_DIR, ".config", "rove"), { recursive: true })
  writeFileSync(
    join(process.env.ROVE_HOME_DIR, ".config", "rove", "state.json"),
    JSON.stringify({ [TAB_STRIP_MODE_KEY]: "never" }),
  )
  const { frame } = await renderComponent(strip("tab-2"), { width: 100, height: 4, providers: { kv: true } })
  expect(await frame()).not.toContain("╭")
})

test("narrow keeps each turn state its own tone, the way the wide strip does", async () => {
  // The narrow form used to paint the chip in `backgroundElement` — one
  // colour for every state, so `● running` and
  // `! error` differed only by glyph. Painting the tone ON the focusAccent
  // fill would not have fixed it either: error red lands at a 1.02 contrast
  // ratio there. The chip therefore sits outside the fill, on ambient.
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-tab-strip-tone-"))
  mkdirSync(join(process.env.ROVE_HOME_DIR, ".config", "rove"), { recursive: true })
  writeFileSync(
    join(process.env.ROVE_HOME_DIR, ".config", "rove", "state.json"),
    JSON.stringify({ [TAB_STRIP_MODE_KEY]: "always" }),
  )
  seedStatus()
  const glyphs: Record<string, readonly string[]> = {
    "tab-2": DEFAULT_GLYPHS.spinner,
    "tab-3": [DEFAULT_GLYPHS.attention],
  }
  async function chipFg(activeId: string) {
    const { spans } = await renderComponent(
      <TabStrip
        taskId="alpha"
        tabs={TABS}
        activeId={activeId}
        onSelect={() => {}}
        vendor="claude"
        liveTitles={new Map()}
        turnVendors={new Map()}
      />,
      { width: 46, height: 4, providers: { kv: true } },
    )
    const span = (await spans()).lines[0]?.spans.find((s) => (glyphs[activeId] ?? []).some((g) => s.text.includes(g)))
    expect(span).toBeDefined()
    return span
  }
  const running = await chipFg("tab-2")
  const error = await chipFg("tab-3")
  expect(running?.fg?.toInts()).not.toEqual(error?.fg?.toInts())
  // And on the ambient surface, not inside the active-tab fill — that fill is
  // where every tone collapsed back into the orange.
  const ambient = (
    await (await renderComponent(strip("tab-2"), { width: 46, height: 4, providers: { kv: true } })).spans()
  ).lines[2]?.spans[0]
  expect(running?.bg?.toInts()).toEqual(ambient?.bg?.toInts())
})
