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
 */

import { afterEach, expect, test } from "bun:test"
import { WhatsNewPage } from "../../src/tui-react/component/whats-new-page"
import { currentLang, setLocaleLang } from "../../src/tui/i18n"
import type { ReleaseNotesRangeItem } from "../../src/version.ts"
import { act, renderComponent } from "./harness"

const restore = currentLang()
afterEach(() => setLocaleLang(restore))

const NOTES: ReleaseNotesRangeItem[] = [
  {
    version: "0.9.205",
    url: "https://github.com/Sma1lboy/rove/releases/tag/v0.9.205",
    body: "- point the logo manifest at the renamed repo root",
  },
]

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 120))

test("English chrome lists the notes for the range just crossed", async () => {
  setLocaleLang("en")
  const { frame } = await renderComponent(
    <WhatsNewPage from="0.9.200" onClose={() => {}} fetchNotes={async () => NOTES} />,
    { width: 80, height: 24 },
  )
  await settle()
  const text = await frame()
  expect(text).toContain("WHAT'S NEW")
  expect(text).toContain("up from v0.9.200")
  expect(text).toContain("renamed repo root")
})

test("Chinese chrome translates the page, not the published note body", async () => {
  setLocaleLang("zh")
  const { frame } = await renderComponent(
    <WhatsNewPage from="0.9.200" onClose={() => {}} fetchNotes={async () => NOTES} />,
    { width: 80, height: 24 },
  )
  await settle()
  const text = await frame()
  expect(text).toContain("更新内容")
  expect(text).toContain("v0.9.200")
  expect(text).toContain("继续")
  // The body is GitHub's, published in English — translating the chrome must
  // not be mistaken for translating the release itself.
  expect(text).toContain("renamed repo root")
})

test("an unreachable GitHub states the failure and still offers the URL", async () => {
  setLocaleLang("en")
  const { frame } = await renderComponent(
    <WhatsNewPage from="0.9.200" onClose={() => {}} fetchNotes={async () => []} />,
    { width: 80, height: 24 },
  )
  await settle()
  const text = await frame()
  expect(text).toContain("Could not load the release notes")
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
  // Still loading — the page must not hold the user hostage to a fetch that
  // may never answer.
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
  await settle()
  const text = await frame()
  // Syntax markers are concealed and the link addresses are gone, so the
  // sentence starts at the left edge instead of behind two GitHub URLs.
  expect(text).toContain("Patch Changes")
  expect(text).toContain("#1032 0b99a4c Engines can now install hooks.")
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
