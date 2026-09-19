/** @jsxImportSource @opentui/react */
/**
 * The post-upgrade first screen, mounted for real.
 *
 * Two things are worth pinning and neither shows up in a unit test: the page
 * renders its chrome in the ACTIVE UI language (the owner's requirement — the
 * note bodies stay in whatever GitHub published), and a failed fetch lands on
 * a stated "could not load" plus the release URL rather than an empty page
 * that looks like a broken build.
 *
 * `fetchNotes` is always stubbed here — the render track must never reach
 * api.github.com.
 *
 * WAIT ON THE BODY, NEVER SLEEP FOR IT. The notes render through opentui's
 * `MarkdownRenderable`, whose tree-sitter parse is asynchronous and whose
 * grammar loads once per PROCESS: measured here, the first markdown mount
 * takes ~190ms and every later one ~90ms. A fixed `settle()` therefore
 * passes or fails on whether some earlier file in the render track happened
 * to warm the grammar first — which is exactly how a 120ms sleep went green
 * on every PR and red on main, reporting an EMPTY body rather than a wrong
 * one. `waitForFrameText` polls for the phrase the test is about, so the
 * wait proves the body rendered instead of racing it.
 */

import { afterEach, expect, test } from "bun:test"
import { WhatsNewPage } from "../../src/tui-react/component/whats-new-page"
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

test("English chrome lists the notes for the range just crossed", async () => {
  setLocaleLang("en")
  const { frame } = await renderComponent(
    <WhatsNewPage from="0.9.200" onClose={() => {}} fetchNotes={async () => NOTES} />,
    { width: 80, height: 24 },
  )
  // The wait IS the assertion that the note body reached the screen.
  const text = await waitForFrameText(frame, "renamed repo root", BODY_TIMEOUT)
  expect(text).toContain("WHAT'S NEW")
  expect(text).toContain("up from v0.9.200")
})

test("Chinese chrome translates the page, not the published note body", async () => {
  setLocaleLang("zh")
  const { frame } = await renderComponent(
    <WhatsNewPage from="0.9.200" onClose={() => {}} fetchNotes={async () => NOTES} />,
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
    <WhatsNewPage from="0.9.200" onClose={() => {}} fetchNotes={async () => []} />,
    { width: 80, height: 24 },
  )
  const text = await waitForFrameText(frame, "Could not load the release notes", BODY_TIMEOUT)
  expect(text).toContain("releases/tag/v")
})

test("q closes without waiting for the fetch", async () => {
  setLocaleLang("en")
  let closed = false
  const { frame, mockInput } = await renderComponent(
    <WhatsNewPage
      from="0.9.200"
      onClose={() => {
        closed = true
      }}
      fetchNotes={() => new Promise(() => [])}
    />,
    { width: 80, height: 24 },
  )
  // Deliberately NOT polled: this asserts the FIRST frame, before any fetch
  // could have answered — the page must not hold the user hostage to one.
  expect(await frame()).toContain("Loading release notes")
  await act(async () => mockInput.typeText("q"))
  expect(closed).toBe(true)
})

test("the note body renders as markdown, not as its source text", async () => {
  setLocaleLang("en")
  const { frame, spans } = await renderComponent(
    <WhatsNewPage
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
