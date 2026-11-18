/** @jsxImportSource @opentui/react */
/**
 * Full-window pages must speak the shell's own vocabulary. Three drifts this
 * file pins, each of which looked fine in isolation and wrong beside the pane
 * next to it:
 *
 *  - the cursor row: `resolveRowSelectionChrome` (▌ marker, no fill under
 *    transparency), not a page-local `primary` bar or a `▸ ` prefix that
 *    already means "collapsed" in the sidebar and the file tree;
 *  - the page-header close affordance: translated, like the title beside it;
 *  - the scrollbar: page-side convention is a slider with no track, so a page
 *    does not hang a `borderActive` rail over the host wallpaper.
 */

import { afterEach, expect, test } from "bun:test"
import type { CapturedFrame } from "@opentui/core"
import { UpdatePage } from "../../src/tui-react/component/update-page"
import { setTransparentBackground } from "../../src/tui-react/context/theme"
import { BUNDLED_THEMES, DEFAULT_THEME, applyDisplayOverlay, resolveTheme } from "../../src/tui/context/theme-core"
import { currentLang, setLocaleLang } from "../../src/tui/i18n"
import { renderComponent, waitForFrameText } from "./harness"

const LANG = currentLang()
afterEach(() => {
  setLocaleLang(LANG)
  setTransparentBackground(true)
})

/** The harness's ThemeProvider defaults, resolved for token comparisons. */
function tokens(transparent: boolean) {
  return applyDisplayOverlay(resolveTheme(BUNDLED_THEMES[DEFAULT_THEME], "dark"), "primary", transparent)
}

function spanWith(frame: CapturedFrame, needle: string) {
  return frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes(needle))
}

/** No network in the render track: keep both of the page's reads deterministic. */
async function withOfflineUpdatePage<T>(run: () => Promise<T>): Promise<T> {
  const prevFake = process.env.ROVE_FAKE_UPDATE ?? ""
  const realFetch = globalThis.fetch
  process.env.ROVE_FAKE_UPDATE = ""
  globalThis.fetch = (async () => {
    throw new Error("offline")
  }) as unknown as typeof fetch
  try {
    return await run()
  } finally {
    globalThis.fetch = realFetch
    process.env.ROVE_FAKE_UPDATE = prevFake
  }
}

// Transparent mode is the case that made this visible: a `primary` bar on a
// full-window page paints an opaque patch straight onto the host wallpaper,
// which is exactly what `row-selection-chrome` exists to prevent. Checked in
// BOTH modes, because "no fill" alone would also pass with the chrome deleted —
// the opaque half pins that the cursor still tints something.
async function cursorRow(transparent: boolean) {
  setTransparentBackground(transparent)
  const { spans } = await withOfflineUpdatePage(async () => {
    const handle = await renderComponent(<UpdatePage onClose={() => {}} />, { width: 74, height: 20 })
    await waitForFrameText(handle.frame, "could not reach the registry")
    return handle
  })
  const frame = await spans()
  // The ▌ marker carries the cursor signal in both modes.
  expect(spanWith(frame, "▌")).toBeDefined()
  // "Close" is the cursor row until the registry reports something newer,
  // and offline it never does.
  const row = spanWith(frame, "Close")
  expect(row).toBeDefined()
  // Never the page-local bar this replaced.
  expect(row?.bg?.toInts()).not.toEqual(tokens(transparent).primary.toInts())
  return row
}

test("the update page's cursor row has no fill in transparent mode", async () => {
  expect((await cursorRow(true))?.bg?.a ?? 0).toBe(0)
})

test("the update page's cursor row takes the shared element tint when opaque", async () => {
  expect((await cursorRow(false))?.bg?.toInts()).toEqual(tokens(false).backgroundElement.toInts())
})

test("the update page header's close hint is translated with its title", async () => {
  setLocaleLang("zh")
  const { frame } = await withOfflineUpdatePage(async () => {
    const handle = await renderComponent(<UpdatePage onClose={() => {}} />, { width: 74, height: 20 })
    await waitForFrameText(handle.frame, "ROVE 更新")
    return handle
  })
  // Pin the HEADER ROW, not the page: `update.actions.close` also renders as
  // 关闭 further down, so a page-wide `toContain` passed with the hint still
  // hardcoded in English.
  const header = (await frame()).split("\n").find((line) => line.includes("ROVE 更新"))
  expect(header).toBeDefined()
  expect(header).toContain("关闭")
  expect(header).not.toContain("q / esc close")
})
