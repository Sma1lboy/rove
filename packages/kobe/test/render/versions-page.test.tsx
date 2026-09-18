/** @jsxImportSource @opentui/react */
/**
 * The `rove update list` versions browser, mounted for real.
 *
 * Both fetches are stubbed — the render track must never reach
 * api.github.com. What is worth pinning here is that the selected row's
 * notes arrive as RENDERED markdown (the same `ReleaseNotesBody` the
 * Update and What's New pages mount), and that moving the cursor swaps
 * which release body is on screen.
 */

import { expect, test } from "bun:test"
import { VersionsPage } from "../../src/tui-react/component/versions-page"
import { currentLang, setLocaleLang } from "../../src/tui/i18n"
import type { ReleaseNotes, ReleaseSummary } from "../../src/version.ts"
import { act, renderComponent } from "./harness"

const SUMMARIES: ReleaseSummary[] = [
  { version: "0.9.208", url: "https://github.com/Sma1lboy/rove/releases/tag/v0.9.208" },
  { version: "0.9.207", url: "https://github.com/Sma1lboy/rove/releases/tag/v0.9.207" },
]

const BODIES: Record<string, string> = {
  "0.9.208":
    "### Patch Changes\n\n- [#1039](https://x/pull/1039) [`76eb2e6`](https://x/commit/76eb2e6) Show what changed on the first launch after an **upgrade**",
  "0.9.207": "### Patch Changes\n\n- [#1027](https://x/pull/1027) A task can now pin a `--model`",
}

function mount() {
  setLocaleLang("en")
  return renderComponent(
    <VersionsPage
      onClose={() => {}}
      fetchSummaries={async () => SUMMARIES}
      fetchNotes={async (version): Promise<ReleaseNotes | null> => {
        const body = BODIES[version]
        return body === undefined ? null : { body, url: `https://x/releases/tag/v${version}`, version }
      }}
    />,
    { width: 100, height: 24 },
  )
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 150))

test("the selected release's notes render as markdown, not as their source", async () => {
  const restore = currentLang()
  try {
    const { frame, spans } = await mount()
    await act(async () => settle())
    const text = await frame()
    expect(text).toContain("ROVE VERSIONS")
    expect(text).toContain("v0.9.208")
    expect(text).toContain("#1039 76eb2e6 Show what changed")
    // Concealed, not printed: the source markers and the link addresses.
    expect(text).not.toContain("###")
    expect(text).not.toContain("**")
    expect(text).not.toContain("https://x/pull/1039")
    const emphasized = (await spans()).lines
      .flatMap((line) => line.spans)
      .filter((span) => span.attributes !== 0)
      .map((span) => span.text.trim())
    expect(emphasized).toContain("upgrade")
  } finally {
    setLocaleLang(restore)
  }
})

test("j moves the cursor and swaps which body is shown", async () => {
  const restore = currentLang()
  try {
    const { frame, mockInput } = await mount()
    await act(async () => settle())
    await act(async () => mockInput.typeText("j"))
    await act(async () => settle())
    const text = await frame()
    expect(text).toContain("A task can now pin a --model")
    expect(text).not.toContain("Show what changed")
  } finally {
    setLocaleLang(restore)
  }
})
