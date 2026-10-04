/**
 * The release-note source transform, fed the repo's OWN changelog.
 *
 * A hand-written sample would be regular in a way real Changesets output is
 * not — nested bullets, indented continuation paragraphs, inline code with
 * flags in it, and two GitHub links opening most bullets. `CHANGELOG.md` is
 * the same text GitHub publishes as the release body, so the invariants are
 * asserted against every release this repo has actually shipped.
 */

import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { releaseNotesMarkdown } from "../../src/tui-react/component/release-notes-markdown"

/** Every `## <version>` section of the changelog, as its own release body. */
function changelogBodies(): Array<{ version: string; body: string }> {
  const text = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8")
  const sections = text.split(/^## /m).slice(1)
  return sections.map((section) => {
    const newline = section.indexOf("\n")
    return { version: section.slice(0, newline).trim(), body: section.slice(newline + 1) }
  })
}

describe("releaseNotesMarkdown", () => {
  test("leaves no link syntax anywhere in the shipped changelog", () => {
    const bodies = changelogBodies()
    expect(bodies.length).toBeGreaterThan(20)
    for (const { version, body } of bodies) {
      const rendered = releaseNotesMarkdown(body)
      // `](` is the only place a markdown link can hide. If one survives, the
      // page prints a raw URL — the wall of addresses this transform exists
      // to remove.
      expect(rendered, `v${version}`).not.toContain("](")
      expect(rendered, `v${version}`).not.toContain("/pull/")
      expect(rendered, `v${version}`).not.toContain("/commit/")
    }
  })

  test("keeps every link label, and the markdown around it", () => {
    const body = [
      "### Patch Changes",
      "",
      "- [#1039](https://github.com/Sma1lboy/rove/pull/1039) [`76eb2e6`](https://github.com/Sma1lboy/rove/commit/76eb2e6a89) Show what changed on the first launch after an upgrade",
      "",
      "  A task can now pin a **model**, the way it pins a `--effort`.",
      "  — [@Sma1lboy](https://github.com/Sma1lboy)",
      "",
    ].join("\n")
    expect(releaseNotesMarkdown(body)).toBe(
      [
        "### Patch Changes",
        "",
        "- #1039 `76eb2e6` Show what changed on the first launch after an upgrade",
        "",
        "  A task can now pin a **model**, the way it pins a `--effort`.",
        "  — @Sma1lboy",
      ].join("\n"),
    )
  })

  test("normalizes CRLF so a Windows-authored body still parses as markdown", () => {
    expect(releaseNotesMarkdown("### Patch Changes\r\n\r\n- one\r\n")).toBe("### Patch Changes\n\n- one")
  })
})
