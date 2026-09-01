/**
 * C-layer gate: pure composer-empty detection from raw ring bytes.
 *
 * No real PTY is started; fixtures are fed through a throwaway headless xterm.
 */

import { describe, expect, it } from "vitest"
import { CLAUDE_SCREEN_MANIFEST } from "../../src/engine/claude-code-local/screen.ts"
import { CODEX_SCREEN_MANIFEST } from "../../src/engine/codex-local/screen.ts"
import { isComposerEmpty } from "../../src/engine/composer-state.ts"
import { KIMI_SCREEN_MANIFEST } from "../../src/engine/kimi-local/screen.ts"
import type { EngineScreenManifest } from "../../src/engine/screen-state.ts"

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function ansi(text: string): Uint8Array {
  // Wrap in a simple color sequence and carriage-return to exercise the
  // parser without changing the visible text.
  return bytes(`\x1b[32m${text}\x1b[0m\r`)
}

describe("isComposerEmpty", async () => {
  it("returns null when the manifest has no composerEmpty rules", async () => {
    const manifest: EngineScreenManifest = { rules: [] }
    expect(await isComposerEmpty(bytes("❯ hello"), manifest)).toBeNull()
  })

  it("returns null when the manifest is undefined", async () => {
    expect(await isComposerEmpty(bytes("❯ hello"), undefined)).toBeNull()
  })

  it("returns true for an empty Claude composer", async () => {
    expect(await isComposerEmpty(bytes("❯"), CLAUDE_SCREEN_MANIFEST)).toBe(true)
    expect(await isComposerEmpty(bytes("  ❯  "), CLAUDE_SCREEN_MANIFEST)).toBe(true)
    expect(await isComposerEmpty(bytes("❯ · ← 8 agents"), CLAUDE_SCREEN_MANIFEST)).toBe(true)
  })

  /**
   * The regression that made every Claude delivery defer.
   *
   * Claude hangs a rule, a status row and a hint row BELOW its composer, so
   * the prompt is four non-empty lines off the bottom. The single-line
   * fixtures above never saw that furniture, which is why they stayed green
   * while production deferred every peer message: `bottomLines: 2` could not
   * reach the prompt, no rule matched, and no-match is fail-closed.
   *
   * Rendering was the other half. At 12 rows a real screen overran the
   * buffer and lines FUSED (`──⏵⏵ bypass permissions on …`), so the composer
   * line did not exist to be matched at any window size.
   */
  const RULE = "─".repeat(150)
  function claudeScreen(composerLine: string): Uint8Array {
    const body = Array.from({ length: 20 }, (_, i) => `  output line ${i}`).join("\r\n")
    return bytes(
      [
        body,
        RULE,
        composerLine,
        RULE,
        "  𖠰 musk | ⎇ fix/x | Ctx… | ⚪ pool",
        "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 8 agents",
      ].join("\r\n"),
    )
  }

  it("sees an empty composer through Claude's status furniture", async () => {
    expect(await isComposerEmpty(claudeScreen("❯ "), CLAUDE_SCREEN_MANIFEST)).toBe(true)
  })

  it("still sees typed text through that same furniture", async () => {
    // The complement: widening the window must not turn the gate into a
    // rubber stamp that reports every screen empty.
    expect(await isComposerEmpty(claudeScreen("❯ ship the docs"), CLAUDE_SCREEN_MANIFEST)).toBe(false)
  })

  it("renders enough rows that a full screen's lines do not fuse", async () => {
    // The other half of the same bug, and it needs REAL cursor positioning to
    // show up: Claude draws with CUF/CUD (`ESC[2C`, `ESC[1B`), not newlines,
    // and in a 12-row buffer those wrapped around and fused rows together
    // (`──⏵⏵ bypass permissions on …` — a rule and the hint row in one line).
    // A \r\n-joined fixture cannot reproduce it: it renders identically at 12
    // and 60 rows, which is why the first version of this test passed against
    // the very constant it was meant to pin.
    const E = String.fromCharCode(27)
    const parts: string[] = []
    for (let i = 0; i < 40; i++) parts.push(`\r${E}[2C${E}[1Boutput line ${i}`)
    parts.push(`\r${E}[1B${RULE}`)
    parts.push(`\r${E}[1B❯ `)
    parts.push(`\r${E}[1B${RULE}`)
    parts.push(`\r${E}[2C${E}[1B  𖠰 musk | ⎇ fix/x`)
    parts.push(`\r${E}[2C${E}[1B  ⏵⏵ bypass permissions on (shift+tab to cycle)`)
    expect(await isComposerEmpty(bytes(parts.join("")), CLAUDE_SCREEN_MANIFEST)).toBe(true)
  })

  it("answers null — not false — when no rule's anchor is on screen", async () => {
    // The safety property behind the outage: when the composer cannot be seen
    // at all, the C layer abstains and the A-layer quiet window decides. The
    // old code returned false here, so ONE upstream UI change deferred every
    // message to every Claude task, indefinitely and silently.
    expect(await isComposerEmpty(bytes("just some output, no prompt glyph"), CLAUDE_SCREEN_MANIFEST)).toBeNull()
  })

  it("returns false when Claude's composer has user text", async () => {
    expect(await isComposerEmpty(bytes("❯ hello"), CLAUDE_SCREEN_MANIFEST)).toBe(false)
    expect(await isComposerEmpty(bytes("❯ fix the bug"), CLAUDE_SCREEN_MANIFEST)).toBe(false)
  })

  it("returns true for an empty Kimi composer", async () => {
    expect(await isComposerEmpty(bytes(">"), KIMI_SCREEN_MANIFEST)).toBe(true)
    expect(await isComposerEmpty(bytes(" │ >                    …│ "), KIMI_SCREEN_MANIFEST)).toBe(true)
  })

  it("returns false when Kimi's composer has user text", async () => {
    expect(await isComposerEmpty(bytes("> hello"), KIMI_SCREEN_MANIFEST)).toBe(false)
    expect(await isComposerEmpty(bytes(" │ > fix it            │ "), KIMI_SCREEN_MANIFEST)).toBe(false)
  })

  it("returns true for an empty Codex composer", async () => {
    expect(await isComposerEmpty(bytes("›"), CODEX_SCREEN_MANIFEST)).toBe(true)
    expect(await isComposerEmpty(bytes("  ›  "), CODEX_SCREEN_MANIFEST)).toBe(true)
    expect(await isComposerEmpty(bytes("› Ask Codex to do anything"), CODEX_SCREEN_MANIFEST)).toBe(true)
  })

  it("returns false when Codex's composer has user text", async () => {
    expect(await isComposerEmpty(bytes("› hello"), CODEX_SCREEN_MANIFEST)).toBe(false)
    expect(
      await isComposerEmpty(bytes("› Ask Codex to do anything about the failing test"), CODEX_SCREEN_MANIFEST),
    ).toBe(false)
  })

  it("matches through ANSI decoration", async () => {
    expect(await isComposerEmpty(ansi("❯"), CLAUDE_SCREEN_MANIFEST)).toBe(true)
    expect(await isComposerEmpty(ansi("❯ hello"), CLAUDE_SCREEN_MANIFEST)).toBe(false)
  })

  it("looks only at the bottom of the screen", async () => {
    const screen = `${Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n")}\n❯`
    expect(await isComposerEmpty(bytes(screen), CLAUDE_SCREEN_MANIFEST)).toBe(true)
  })
})
