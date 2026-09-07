import { describe, expect, it } from "vitest"
import {
  TITLE_CHAR_CAP,
  deriveTitleFromPrompt,
  isPlaceholderDerivedBranch,
  sanitizeTaskTitle,
} from "../../src/orchestrator/title.ts"

describe("isPlaceholderDerivedBranch", () => {
  it("recognizes the convention-era placeholder shapes", () => {
    const id = "01HXABCDEF"
    expect(isPlaceholderDerivedBranch("new-task", id)).toBe(true)
    expect(isPlaceholderDerivedBranch("feat/new-task", id)).toBe(true)
    expect(isPlaceholderDerivedBranch("new-task-2", id)).toBe(true)
    expect(isPlaceholderDerivedBranch("fix/new-task-3", id)).toBe(true)
  })

  it("recognizes the legacy rove/ and kobe/ id-suffixed placeholders", () => {
    const id = "01HXABCDEF"
    expect(isPlaceholderDerivedBranch("rove/new-task-abcdef", id)).toBe(true)
    expect(isPlaceholderDerivedBranch("kobe/new-task-abcdef", id)).toBe(true)
  })

  it("rejects real branch names", () => {
    const id = "01HXABCDEF"
    expect(isPlaceholderDerivedBranch("kobe/real-work-abcdef", id)).toBe(false)
    expect(isPlaceholderDerivedBranch("feat/login-flow", id)).toBe(false)
    expect(isPlaceholderDerivedBranch("rove/new-task-zzzzzz", id)).toBe(false)
  })
})

describe("deriveTitleFromPrompt", () => {
  it("collapses whitespace into a one-line label", () => {
    expect(deriveTitleFromPrompt("  add   a\n  feature ")).toBe("add a feature")
  })

  it("returns '' for empty / non-string input", () => {
    expect(deriveTitleFromPrompt("")).toBe("")
    expect(deriveTitleFromPrompt("   \n  ")).toBe("")
    expect(deriveTitleFromPrompt(undefined as unknown as string)).toBe("")
  })

  it("truncates with an ellipsis past the cap", () => {
    const long = "x".repeat(TITLE_CHAR_CAP + 20)
    const out = deriveTitleFromPrompt(long)
    expect(out.endsWith("…")).toBe(true)
    expect([...out].length).toBe(TITLE_CHAR_CAP + 1) // capped chars + the ellipsis
  })

  it("never splits a surrogate pair when truncating at the cap", () => {
    // An emoji straddling the cut point must not be bisected into an orphaned
    // half (which renders as a replacement glyph).
    const prompt = `${"x".repeat(TITLE_CHAR_CAP - 1)}😀tail`
    const out = deriveTitleFromPrompt(prompt)
    expect(out.endsWith("…")).toBe(true)
    expect(out).not.toContain("�")
    // No lone surrogate: a UTF-8 round-trip is lossless only if every surrogate
    // is paired.
    expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out)
  })
})

describe("sanitizeTaskTitle", () => {
  it("flattens a newline into a single space instead of letting it through", () => {
    // `add --title $'line1\nline2'` used to land verbatim in the store. The
    // sidebar row is `wrapMode="none"` and display-width measures a newline
    // as ZERO cells, so the truncator never sees it and the row grows a
    // second line at render time.
    expect(sanitizeTaskTitle("line1\nline2")).toBe("line1 line2")
    expect(sanitizeTaskTitle("a\r\nb")).toBe("a b")
  })

  it("strips every C0 control, not just the newline — they all measure zero", () => {
    expect(sanitizeTaskTitle("a\tb")).toBe("a b")
    expect(sanitizeTaskTitle("red\u001b[31mtext")).toBe("red [31mtext")
    expect(sanitizeTaskTitle("a\u0000b")).toBe("a b")
  })

  it("collapses runs and trims the edges, so nothing becomes a wall of spaces", () => {
    expect(sanitizeTaskTitle("  \n\n a  \n b \n ")).toBe("a b")
  })

  it("leaves an ordinary title — including a non-Latin one — byte-for-byte alone", () => {
    expect(sanitizeTaskTitle("fix the login flow")).toBe("fix the login flow")
    expect(sanitizeTaskTitle("修复中文标题的分支推导")).toBe("修复中文标题的分支推导")
    expect(sanitizeTaskTitle("😀😀😀")).toBe("😀😀😀")
  })

  it("reduces a control-only title to the empty string, so callers can fall back", () => {
    // `createTask` swaps this for the placeholder; `setTitle` rejects it.
    expect(sanitizeTaskTitle("\n\n\t ")).toBe("")
  })
})
