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
import type { ChatTabTurnState } from "../../src/engine/turn-detector"
import { TAB_STRIP_MODE_KEY } from "../../src/state/tab-strip"
import { setTransparentBackground } from "../../src/tui-react/context/theme"
import { TabStrip } from "../../src/tui-react/workspace/tab-strip"
import type { TerminalTab } from "../../src/tui/workspace/terminal-tabs-core"
import { renderComponent } from "./harness"

process.env.KOBE_HOME_DIR ??= mkdtempSync(join(tmpdir(), "kobe-tab-strip-test-"))

const TABS: readonly TerminalTab[] = [
  { kind: "engine", id: "tab-1", title: null, ordinal: 1 },
  { kind: "engine", id: "tab-2", title: "a much longer engine tab title than fits", ordinal: 2 },
  { kind: "engine", id: "tab-3", title: null, ordinal: 3 },
]

function strip(activeId: string) {
  return (
    <TabStrip
      tabs={TABS}
      activeId={activeId}
      turnStates={new Map<string, ChatTabTurnState>([["tab-2", "running"]])}
      onSelect={() => {}}
      vendor="claude"
      liveTitles={new Map()}
      turnVendors={new Map()}
    />
  )
}

test("narrow strip shows the active tab truncated with a position counter", async () => {
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-tab-strip-narrow-"))
  mkdirSync(join(process.env.KOBE_HOME_DIR, ".config", "rove"), { recursive: true })
  writeFileSync(
    join(process.env.KOBE_HOME_DIR, ".config", "rove", "state.json"),
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
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-tab-strip-always-"))
  mkdirSync(join(process.env.KOBE_HOME_DIR, ".config", "rove"), { recursive: true })
  writeFileSync(
    join(process.env.KOBE_HOME_DIR, ".config", "rove", "state.json"),
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
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-tab-strip-never-"))
  mkdirSync(join(process.env.KOBE_HOME_DIR, ".config", "rove"), { recursive: true })
  writeFileSync(
    join(process.env.KOBE_HOME_DIR, ".config", "rove", "state.json"),
    JSON.stringify({ [TAB_STRIP_MODE_KEY]: "never" }),
  )
  const { frame } = await renderComponent(strip("tab-2"), { width: 100, height: 4, providers: { kv: true } })
  expect(await frame()).not.toContain("╭")
})

test("narrow strip paints no row background of its own — in either display mode", async () => {
  // The strip is panel chrome, and the WIDE branch of this same component
  // paints no row background at all; the narrow branch must agree. The
  // contract is "no background OF ITS OWN": the counter cell must show the
  // exact ambient surface the empty rows below the strip show. Checked in
  // both display modes, because each catches a different wrong token —
  //   - `backgroundElement` (#2B2A27) stays opaque under transparency (it
  //     exists for readable fills — chat input, split name tags) and would
  //     smear an opaque bar across the host wallpaper;
  //   - `backgroundPanel` (#1A1917) is invisible under transparency but in
  //     opaque mode paints a raised bar the wide branch never has.
  // Only the active tab's chip may paint: it must stay legible on any
  // backdrop.
  for (const transparent of [true, false]) {
    setTransparentBackground(transparent)
    try {
      const { spans } = await renderComponent(strip("tab-2"), { width: 46, height: 4, providers: { kv: true } })
      const lines = (await spans()).lines
      const counter = lines[0]?.spans.find((span) => span.text.includes("2/3"))
      // A row below the strip: nothing but the ambient surface.
      const ambient = lines[2]?.spans[0]
      expect(counter).toBeDefined()
      expect(ambient).toBeDefined()
      expect(counter?.bg?.toInts()).toEqual(ambient?.bg?.toInts())
      // The active tab's chip fill legitimately stays opaque — sanity that
      // the assertion above isn't passing because nothing painted at all.
      const chip = lines[0]?.spans.find((span) => span.text.includes("a much longer"))
      expect(chip?.bg?.toInts()).not.toEqual(ambient?.bg?.toInts())
      expect((chip?.bg?.a ?? 0) > 0).toBe(true)
    } finally {
      setTransparentBackground(false)
    }
  }
})
