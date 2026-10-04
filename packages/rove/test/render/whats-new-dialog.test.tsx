/** @jsxImportSource @opentui/react */
/**
 * The post-upgrade notes, mounted for real.
 *
 * Three things are worth pinning and none shows up in a unit test: the
 * dialog renders its chrome in the ACTIVE UI language (the owner's
 * requirement — the note bodies stay in whatever GitHub published), a failed
 * fetch lands on a stated "could not load" plus the release URL rather than
 * an empty card that looks like a broken build, and a range longer than the
 * card is reachable to its END. The last one is the whole reason the body
 * scrolls: an upgrade that crossed six releases is taller than any modal.
 *
 * `fetchNotes` is always stubbed here — the render track must never reach
 * api.github.com.
 *
 * WAIT ON THE BODY, NEVER SLEEP FOR IT (#1047). The notes render through
 * opentui's `MarkdownRenderable`, whose tree-sitter parse is asynchronous and
 * whose grammar loads once per PROCESS: the first markdown mount takes
 * ~190ms and every later one ~90ms, so a fixed sleep passes or fails on
 * whether some earlier file in the render track warmed the grammar first.
 * `waitForFrameText` polls for the phrase each test is about, so the wait
 * proves the body rendered instead of racing it.
 */

import { afterEach, expect, test } from "bun:test"
import { useEffect, useState } from "react"
import { WhatsNewDialogView, useWhatsNewDialog } from "../../src/tui-react/component/whats-new-dialog"
import { currentLang, setLocaleLang } from "../../src/tui/i18n"
import type { ReleaseNotesRangeItem } from "../../src/version.ts"
import { act, renderComponent, waitForFrameText } from "./harness"

const restore = currentLang()
afterEach(() => setLocaleLang(restore))

const NOTES: ReleaseNotesRangeItem[] = [
  {
    version: "0.9.205",
    url: "https://github.com/Sma1lboy/rove/releases/tag/v0.9.205",
    body: "- point the logo manifest at the renamed repo root",
  },
]

/** Well under bun's 5000ms per-test kill, so a real regression still gets to
 *  print `waitForFrameText`'s frame dump instead of a bare bun timeout. */
const BODY_TIMEOUT = { timeoutMs: 3_000 }

/** For the frames with no markdown in them — a scroll position, a dismissal.
 *  Anything asserting a NOTE BODY waits on the text instead. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 120))

test("Chinese chrome translates the dialog, not the published note body", async () => {
  setLocaleLang("zh")
  const { frame } = await renderComponent(
    <WhatsNewDialogView from="0.9.200" onClose={() => {}} fetchNotes={async () => NOTES} />,
    { width: 80, height: 24 },
  )
  // The body is GitHub's, published in English — translating the chrome must
  // not be mistaken for translating the release itself. Waiting on the English
  // phrase is what pins that: it has to be on screen under a Chinese chrome.
  const text = await waitForFrameText(frame, "renamed repo root", BODY_TIMEOUT)
  expect(text).toContain("更新内容")
  expect(text).toContain("v0.9.200")
  expect(text).toContain("继续")
})

test("an unreachable GitHub states the failure and still offers the URL", async () => {
  setLocaleLang("en")
  const { frame } = await renderComponent(
    <WhatsNewDialogView from="0.9.200" onClose={() => {}} fetchNotes={async () => []} />,
    { width: 80, height: 24 },
  )
  const text = await waitForFrameText(frame, "Could not load the release notes", BODY_TIMEOUT)
  expect(text).toContain("releases/tag/v")
})

test("q closes without waiting for the fetch", async () => {
  setLocaleLang("en")
  let closed = false
  const { frame, mockInput } = await renderComponent(
    <WhatsNewDialogView
      from="0.9.200"
      onClose={() => {
        closed = true
      }}
      fetchNotes={() => new Promise(() => [])}
    />,
    { width: 80, height: 24 },
  )
  // Deliberately NOT polled: this asserts the FIRST frame, before any fetch
  // could have answered — the dialog must not hold the user hostage to one.
  expect(await frame()).toContain("Loading release notes")
  await act(async () => mockInput.typeText("q"))
  expect(closed).toBe(true)
})

/** Six releases, each several lines: taller than any card, which is exactly
 *  the upgrade this dialog exists for. */
function longRange(): ReleaseNotesRangeItem[] {
  return Array.from({ length: 6 }, (_, i) => ({
    version: `0.9.2${String(i).padStart(2, "0")}`,
    url: `https://github.com/Sma1lboy/rove/releases/tag/v0.9.2${i}`,
    body: `- change ${i} alpha\n- change ${i} beta\n- change ${i} gamma\n- LAST-LINE-${i}`,
  }))
}

test("scrolling back up returns to the first release", async () => {
  setLocaleLang("en")
  const { frame, mockInput } = await renderComponent(
    <WhatsNewDialogView from="0.9.200" onClose={() => {}} fetchNotes={async () => longRange()} />,
    { width: 80, height: 24 },
  )
  await waitForFrameText(frame, "LAST-LINE-0", BODY_TIMEOUT)
  for (let i = 0; i < 25; i++) await act(async () => mockInput.pressArrow("down"))
  await waitForFrameText(frame, "LAST-LINE-5", BODY_TIMEOUT)
  expect(await frame()).not.toContain("LAST-LINE-0")
  for (let i = 0; i < 25; i++) await act(async () => mockInput.pressArrow("up"))
  await waitForFrameText(frame, "LAST-LINE-0", BODY_TIMEOUT)
})

/**
 * The WIRING, not the view: What's New is handed to the dialog stack on
 * mount, and the host's one-shot state is cleared exactly once on the way
 * out. The old page version of this claim was a precedence check inside the
 * page router; a modal has no precedence to check, so the only thing left to
 * prove is that it opens at all and that dismissing it settles the state.
 */
test("the host hands What's New to the dialog stack, and clears its state on dismiss", async () => {
  setLocaleLang("en")
  let closedCount = 0
  const onClosed = () => {
    closedCount++
  }
  function Harness() {
    useWhatsNewDialog("0.9.200", onClosed, async () => NOTES)
    return <text>workspace</text>
  }
  const { frame, mockInput } = await renderComponent(<Harness />, {
    width: 80,
    height: 24,
    providers: { dialog: true },
  })
  // The modal is over the workspace, not instead of it — the thing the user
  // came back to is still on screen behind it.
  const open = await waitForFrameText(frame, "WHAT'S NEW", BODY_TIMEOUT)
  expect(open).toContain("workspace")
  await act(async () => mockInput.typeText("q"))
  await settle()
  expect(await frame()).not.toContain("WHAT'S NEW")
  expect(closedCount).toBe(1)
})

test("it opens once — a re-render does not put it back", async () => {
  setLocaleLang("en")
  function Harness() {
    const [, bump] = useState(0)
    useWhatsNewDialog(
      "0.9.200",
      () => {},
      async () => NOTES,
    )
    useEffect(() => {
      const timer = setTimeout(() => bump(1), 10)
      return () => clearTimeout(timer)
    }, [])
    return <text>workspace</text>
  }
  const { frame, mockInput } = await renderComponent(<Harness />, {
    width: 80,
    height: 24,
    providers: { dialog: true },
  })
  await settle()
  await act(async () => mockInput.typeText("q"))
  await settle()
  expect(await frame()).not.toContain("WHAT'S NEW")
})
