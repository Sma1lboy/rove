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

test("English chrome lists the notes for the range just crossed", async () => {
  setLocaleLang("en")
  const { frame } = await renderComponent(
    <WhatsNewDialogView from="0.9.200" onClose={() => {}} fetchNotes={async () => NOTES} />,
    { width: 80, height: 24 },
  )
  // The wait IS the assertion that the note body reached the screen.
  const text = await waitForFrameText(frame, "renamed repo root", BODY_TIMEOUT)
  expect(text).toContain("WHAT'S NEW")
  expect(text).toContain("up from v0.9.200")
})

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

test("the note body renders as markdown, not as its source text", async () => {
  setLocaleLang("en")
  const { frame, spans } = await renderComponent(
    <WhatsNewDialogView
      from="0.9.200"
      onClose={() => {}}
      fetchNotes={async () => [
        {
          version: "0.9.208",
          url: "https://github.com/Sma1lboy/rove/releases/tag/v0.9.208",
          body: "### Patch Changes\n\n- [#1032](https://x/pull/1032) [`0b99a4c`](https://x/commit/0b99a4c) Engines can now install **hooks**. — [@Sma1lboy](https://github.com/Sma1lboy)",
        },
      ]}
    />,
    { width: 80, height: 24 },
  )
  // Syntax markers are concealed and the link addresses are gone, so the
  // sentence starts at the left edge instead of behind two GitHub URLs.
  const text = await waitForFrameText(frame, "#1032 0b99a4c Engines can now install hooks.", BODY_TIMEOUT)
  expect(text).toContain("Patch Changes")
  expect(text).not.toContain("###")
  expect(text).not.toContain("**")
  expect(text).not.toContain("https://x/pull/1032")
  // Rendered, not just stripped: the emphasis survives as an attribute.
  const bold = (await spans()).lines
    .flatMap((line) => line.spans)
    .filter((span) => span.attributes !== 0)
    .map((span) => span.text.trim())
  expect(bold).toContain("hooks")
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

/**
 * Driven with the ARROW keys, not `end`.
 *
 * `end`/`home`/`pageup`/`pagedown` are bound (the same `scrollToEdge` /
 * `scrollBy` pair the help dialog ships), but this mock delivers key NAMES
 * and has no helper that produces a real End byte — a `pressKey("end")`
 * passes through as the letters and scrolls nothing, which would make this
 * test green for the wrong reason or red for one. Arrows have a helper that
 * delivers the real sequence, and they exercise the same scrollbox, so they
 * are what the claim rests on here. The named keys are covered where a real
 * terminal presses them: the /harness visual path.
 */
test("a long range is reachable past the fold — the body scrolls", async () => {
  setLocaleLang("en")
  const { frame, mockInput } = await renderComponent(
    <WhatsNewDialogView from="0.9.200" onClose={() => {}} fetchNotes={async () => longRange()} />,
    { width: 80, height: 24 },
  )
  // Wait on the BODY, not a sleep — these are markdown mounts too.
  const top = await waitForFrameText(frame, "LAST-LINE-0", BODY_TIMEOUT)
  // The first release is on screen and the last one is below the fold.
  expect(top).not.toContain("LAST-LINE-5")
  for (let i = 0; i < 25; i++) await act(async () => mockInput.pressArrow("down"))
  await waitForFrameText(frame, "LAST-LINE-5", BODY_TIMEOUT)
})

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
