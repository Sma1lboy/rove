import { describe, expect, test } from "bun:test"
import { parseReleaseNotes } from "../src/release-notes.tsx"

const body = `### Patch Changes

- [#1347](https://github.com/Sma1lboy/rove/pull/1347) [\`e7a958d\`](https://github.com/Sma1lboy/rove/commit/e7a958d) Each phone or browser can now have its own token.
  The bridge log names the device on connect. — [@Sma1lboy](https://github.com/Sma1lboy)

- [#1340](https://github.com/Sma1lboy/rove/pull/1340) [\`9c6a189\`](https://github.com/Sma1lboy/rove/commit/9c6a189) Dispatching refuses an unpushed base.`

describe("release notes", () => {
  test("headings and bullets, a wrapped line joining its bullet", () => {
    const blocks = parseReleaseNotes(body)
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "item", "item"])
    expect(blocks[0]?.text).toBe("Patch Changes")
    expect(blocks[1]?.text).toContain("own token. The bridge log names the device on connect.")
  })

  test("the commit-sha link and the author go, the PR link stays", () => {
    const [, first, second] = parseReleaseNotes(body)
    expect(first?.text.startsWith("[#1347](https://github.com/Sma1lboy/rove/pull/1347) Each phone")).toBe(true)
    expect(first?.text).not.toContain("e7a958d")
    expect(first?.text).not.toContain("@Sma1lboy")
    expect(second?.text).toBe(
      "[#1340](https://github.com/Sma1lboy/rove/pull/1340) Dispatching refuses an unpushed base.",
    )
  })
})
