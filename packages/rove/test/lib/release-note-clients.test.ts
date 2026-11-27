import { describe, expect, test } from "vitest"
import { TUI_NOTE_CLIENTS, entryClients, splitReleaseNotes } from "../../src/lib/release-note-clients"

const PR =
  "[#2237](https://github.com/Sma1lboy/rove/pull/2237) [`db9b931`](https://github.com/Sma1lboy/rove/commit/db9b931)"

describe("entryClients", () => {
  test("reads one tag, several, and the link-stripped form the TUI renders", () => {
    expect(entryClients(`- ${PR} **tui** Press / to search.`)).toEqual(["tui"])
    expect(entryClients(`- ${PR} **web · ios** On a phone, …`)).toEqual(["web", "ios"])
    expect(entryClients("- #2237 `db9b931` **daemon** The daemon …")).toEqual(["daemon"])
  })

  test("untagged and malformed entries are untagged", () => {
    expect(entryClients(`- ${PR} The Files pane lists …`)).toBeNull()
    expect(entryClients(`- ${PR} **mac** Unknown client.`)).toBeNull()
    expect(entryClients(`- ${PR} **Web** Capitalised.`)).toBeNull()
    expect(entryClients(`- ${PR} Text with **bold** inside.`)).toBeNull()
  })
})

describe("splitReleaseNotes", () => {
  const body = [
    "### Patch Changes",
    "",
    `- ${PR} **web · ios** Phone glass.`,
    "  A wrapped line of the phone entry.",
    "",
    `- ${PR} **tui** Files search.`,
    "",
    `- ${PR} Untagged, shown everywhere.`,
    "",
    `- ${PR} **android** Android only.`,
  ].join("\n")

  test("own entries and untagged ones stay; the rest go under the same heading", () => {
    const { own, other, otherCount } = splitReleaseNotes(body, TUI_NOTE_CLIENTS)
    expect(own).toContain("### Patch Changes")
    expect(own).toContain("Files search.")
    expect(own).toContain("Untagged, shown everywhere.")
    expect(own).not.toContain("Phone glass.")
    expect(otherCount).toBe(2)
    expect(other.startsWith("### Patch Changes")).toBe(true)
    expect(other).toContain("A wrapped line of the phone entry.")
    expect(other).toContain("Android only.")
  })

  test("an untagged release is all own, with nothing folded", () => {
    const untagged = `### Patch Changes\n\n- ${PR} One.\n\n- ${PR} Two.`
    expect(splitReleaseNotes(untagged, TUI_NOTE_CLIENTS)).toEqual({ own: untagged, other: "", otherCount: 0 })
  })
})
