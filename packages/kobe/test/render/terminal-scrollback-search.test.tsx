/** @jsxImportSource @opentui/react */
/**
 * Real-render coverage for the terminal pane's scrollback search: the
 * `prefix /` chord, the live query, the viewport jump onto a hit that was
 * off-screen, the accent paint on the current hit, `esc` restoring the
 * viewport, and the alternate-screen refusal.
 *
 * Driven through actual keystrokes rather than the hook's callbacks, because
 * the half most likely to break is the key routing: the pane forwards every
 * printable character to the PTY unless the query row switches that off.
 */

import { expect, test } from "bun:test"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import { resetPrefixState } from "../../src/tui/lib/keymap-dispatch"
import { createScriptedPtyRegistry } from "../../src/tui/panes/terminal/pty-scripted"
import { type RenderHandle, act, renderComponent, settle } from "./harness"

/** Row 12 of 200 — far above the 16-row viewport, so a hit there can only be reached by scrolling. */
const HIT_ROW = 12
const HIT = "PARSER-HIT"

function scrollbackLines(): string {
  return Array.from({ length: 200 }, (_, i) => (i === HIT_ROW ? `line-${i} ${HIT}` : `line-${i}`)).join("\r\n")
}

async function mountWithScrollback(): Promise<{
  handle: RenderHandle
  harness: ReturnType<typeof createScriptedPtyRegistry>
}> {
  const harness = createScriptedPtyRegistry()
  let handle: RenderHandle | undefined
  await act(async () => {
    handle = await renderComponent(
      <Terminal cwd="/wt" taskId="scrollback-search" focused registry={harness.registry} />,
      { width: 60, height: 16, providers: { dialog: true } },
    )
  })
  if (!handle) throw new Error("terminal mount failed")
  await act(async () => {
    harness.last().feed(scrollbackLines())
    await handle?.frame()
  })
  return { handle, harness }
}

/** The proposed chord: prefix (ctrl+a) then `/`. */
async function openSearch(handle: RenderHandle): Promise<void> {
  await act(async () => {
    handle.mockInput.pressKey("a", { ctrl: true })
    handle.mockInput.pressKey("/")
    await settle()
  })
}

async function type(handle: RenderHandle, text: string): Promise<void> {
  await act(async () => {
    await handle.mockInput.typeText(text)
    await settle()
  })
}

test("prefix / searches the scrollback and scrolls the viewport onto the hit", async () => {
  const { handle, harness } = await mountWithScrollback()
  try {
    // Baseline: the pane follows the bottom, so the hit is not on screen and
    // nothing has been written to the PTY yet.
    expect(await handle.frame()).not.toContain(HIT)
    expect(await handle.frame()).toContain("line-199")

    await openSearch(handle)
    // Lower-case query against an upper-case hit: matching is case-folded.
    await type(handle, "parser-hit")

    const searching = await handle.frame()
    expect(searching).toContain(HIT)
    expect(searching).toContain("line-12")
    // Query row: the literal typed, and the 1-of-1 position readout.
    expect(searching).toContain("/parser-hit")
    expect(searching).toContain("1/1")
    // The query never reached the shell — the passthrough is off while the row is open.
    expect(harness.last().writeLog.join("")).toBe("")

    // esc closes and puts the viewport back where the search started.
    await act(async () => {
      handle.mockInput.pressEscape()
      await settle()
    })
    const restored = await handle.frame()
    expect(restored).not.toContain(HIT)
    expect(restored).not.toContain("/parser-hit")
    expect(restored).toContain("line-199")
  } finally {
    act(() => handle.destroy())
    resetPrefixState()
  }
})

test("a fresh query parks on the newest hit and enter walks back through history", async () => {
  const { handle, harness } = await mountWithScrollback()
  try {
    await act(async () => {
      // Three more hits, all newer than HIT_ROW: 4 in total, top-first.
      harness.last().feed(`\r\n${HIT}-b\r\n${HIT}-c\r\n${HIT}-d`)
      await handle.frame()
    })
    await openSearch(handle)
    await type(handle, "parser-hit")
    // A scrollback is read newest-first, so a new query parks on the LAST hit.
    expect(await handle.frame()).toContain("4/4")

    // `enter` and `up` both walk toward older output; the walk wraps at the top.
    for (const expected of ["3/4", "2/4", "1/4", "4/4"]) {
      await act(async () => {
        handle.mockInput.pressEnter()
        await settle()
      })
      expect(await handle.frame()).toContain(expected)
    }

    // `down` walks back toward newer output.
    await act(async () => {
      handle.mockInput.pressArrow("up")
      await settle()
    })
    expect(await handle.frame()).toContain("3/4")
    await act(async () => {
      handle.mockInput.pressArrow("down")
      await settle()
    })
    expect(await handle.frame()).toContain("4/4")

    // The oldest hit is 100+ lines up: reaching it means the viewport moved.
    await act(async () => {
      handle.mockInput.pressArrow("down")
      await settle()
    })
    const oldest = await handle.frame()
    expect(oldest).toContain("1/4")
    expect(oldest).toContain("line-12")
  } finally {
    act(() => handle.destroy())
    resetPrefixState()
  }
})

test("the current hit paints in the accent instead of the selection's inverse video", async () => {
  const { handle } = await mountWithScrollback()
  try {
    await openSearch(handle)
    await type(handle, "parser-hit")

    const hit = (await handle.spans()).lines.flatMap((line) => line.spans).find((span) => span.text.includes(HIT))
    expect(hit).toBeDefined()
    // Accent on the claude dark theme — a flat background, not an inverse of
    // the row's own colors, which is what distinguishes the parked hit from
    // the others on screen.
    expect(hit?.bg?.toInts()).not.toEqual([0, 0, 0, 0])
    expect(hit?.bg?.toInts()).not.toEqual(hit?.fg?.toInts())
  } finally {
    act(() => handle.destroy())
    resetPrefixState()
  }
})

test("search refuses on the alternate screen, where the app owns the scrollback", async () => {
  const { handle, harness } = await mountWithScrollback()
  try {
    harness.last().onAlternateScreen = true
    await act(async () => {
      await handle.frame()
    })
    await openSearch(handle)

    const refused = await handle.frame()
    expect(refused).toMatch(/owns its own scrollback|自己管理回滚缓冲区/)
    // No query row, so nothing pretends to be searchable.
    expect(refused).not.toContain("/parser-hit")
  } finally {
    act(() => handle.destroy())
    resetPrefixState()
  }
})
