/**
 * C-layer gate: pure composer-empty detection from raw ring bytes.
 *
 * No real PTY is started; fixtures are fed through a throwaway headless xterm.
 */

import { describe, expect, it } from "vitest"
import { CLAUDE_SCREEN_MANIFEST } from "../../src/engine/claude-code-local/screen.ts"
import { CODEX_SCREEN_MANIFEST } from "../../src/engine/codex-local/screen.ts"
import { readComposerState } from "../../src/engine/composer-state.ts"
import { KIMI_SCREEN_MANIFEST } from "../../src/engine/kimi-local/screen.ts"
import type { EngineScreenManifest } from "../../src/engine/screen-state.ts"

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** The `.empty` tri-state — the assertion every legacy case here makes. */
async function empty(
  ringBytes: Uint8Array,
  manifest: Parameters<typeof readComposerState>[1],
): Promise<boolean | null> {
  return (await readComposerState(ringBytes, manifest)).empty
}

function ansi(text: string): Uint8Array {
  // Wrap in a simple color sequence and carriage-return to exercise the
  // parser without changing the visible text.
  return bytes(`\x1b[32m${text}\x1b[0m\r`)
}

describe("readComposerState", async () => {
  it("returns null when the manifest has no composerEmpty rules", async () => {
    const manifest: EngineScreenManifest = { rules: [] }
    expect(await empty(bytes("❯ hello"), manifest)).toBeNull()
  })

  it("returns null when the manifest is undefined", async () => {
    expect(await empty(bytes("❯ hello"), undefined)).toBeNull()
  })

  it("returns true for an empty Claude composer", async () => {
    expect(await empty(bytes("❯"), CLAUDE_SCREEN_MANIFEST)).toBe(true)
    expect(await empty(bytes("  ❯  "), CLAUDE_SCREEN_MANIFEST)).toBe(true)
    expect(await empty(bytes("❯ · ← 8 agents"), CLAUDE_SCREEN_MANIFEST)).toBe(true)
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
    expect(await empty(claudeScreen("❯ "), CLAUDE_SCREEN_MANIFEST)).toBe(true)
  })

  it("still sees typed text through that same furniture", async () => {
    // The complement: widening the window must not turn the gate into a
    // rubber stamp that reports every screen empty.
    expect(await empty(claudeScreen("❯ ship the docs"), CLAUDE_SCREEN_MANIFEST)).toBe(false)
  })

  it("renders enough rows that a full screen's lines do not fuse", async () => {
    // The other half of the same bug, and it needs REAL cursor positioning to
    // show up: Claude draws with CUF/CUD (`ESC[2C`, `ESC[1B`), not newlines,
    // and in a 12-row buffer those wrapped around and fused rows together
    // (`──⏵⏵ bypass permissions on …` — a rule and the hint row in one line).
    // A \r\n-joined fixture cannot reproduce it: it renders identically at 12
    // and 60 rows, so it would pass against the very constant it is meant to
    // pin.
    const E = String.fromCharCode(27)
    const parts: string[] = []
    for (let i = 0; i < 40; i++) parts.push(`\r${E}[2C${E}[1Boutput line ${i}`)
    parts.push(`\r${E}[1B${RULE}`)
    parts.push(`\r${E}[1B❯ `)
    parts.push(`\r${E}[1B${RULE}`)
    parts.push(`\r${E}[2C${E}[1B  𖠰 musk | ⎇ fix/x`)
    parts.push(`\r${E}[2C${E}[1B  ⏵⏵ bypass permissions on (shift+tab to cycle)`)
    expect(await empty(bytes(parts.join("")), CLAUDE_SCREEN_MANIFEST)).toBe(true)
  })

  it("answers null — not false — when no rule's anchor is on screen", async () => {
    // The safety property behind the outage: when the composer cannot be seen
    // at all, the C layer abstains and the A-layer quiet window decides. The
    // old code returned false here, so ONE upstream UI change deferred every
    // message to every Claude task, indefinitely and silently.
    expect(await empty(bytes("just some output, no prompt glyph"), CLAUDE_SCREEN_MANIFEST)).toBeNull()
  })

  it("returns false when Claude's composer has user text", async () => {
    expect(await empty(bytes("❯ hello"), CLAUDE_SCREEN_MANIFEST)).toBe(false)
    expect(await empty(bytes("❯ fix the bug"), CLAUDE_SCREEN_MANIFEST)).toBe(false)
  })

  it("returns true for an empty Kimi composer", async () => {
    expect(await empty(bytes(">"), KIMI_SCREEN_MANIFEST)).toBe(true)
    expect(await empty(bytes(" │ >                    …│ "), KIMI_SCREEN_MANIFEST)).toBe(true)
  })

  it("returns false when Kimi's composer has user text", async () => {
    expect(await empty(bytes("> hello"), KIMI_SCREEN_MANIFEST)).toBe(false)
    expect(await empty(bytes(" │ > fix it            │ "), KIMI_SCREEN_MANIFEST)).toBe(false)
  })

  it("returns true for an empty Codex composer", async () => {
    expect(await empty(bytes("›"), CODEX_SCREEN_MANIFEST)).toBe(true)
    expect(await empty(bytes("  ›  "), CODEX_SCREEN_MANIFEST)).toBe(true)
    expect(await empty(ansi("› \u001b[2mAsk Codex to do anything\u001b[22m"), CODEX_SCREEN_MANIFEST)).toBe(true)
  })

  it("returns false when Codex's composer has user text", async () => {
    expect(await empty(bytes("› hello"), CODEX_SCREEN_MANIFEST)).toBe(false)
    // Codex renders its placeholder dimmed. The same visible text in the
    // default style is a real user draft and must never be submitted.
    expect(await empty(bytes("› Ask Codex to do anything"), CODEX_SCREEN_MANIFEST)).toBe(false)
    expect(await empty(bytes("› Ask Codex to do anything about the failing test"), CODEX_SCREEN_MANIFEST)).toBe(false)
  })

  it("fails closed when Codex changes its placeholder copy", async () => {
    expect(await empty(ansi("› \u001b[2mAsk Codex for help\u001b[22m"), CODEX_SCREEN_MANIFEST)).toBe(false)
  })

  it("matches through ANSI decoration", async () => {
    expect(await empty(ansi("❯"), CLAUDE_SCREEN_MANIFEST)).toBe(true)
    expect(await empty(ansi("❯ hello"), CLAUDE_SCREEN_MANIFEST)).toBe(false)
  })

  it("looks only at the bottom of the screen", async () => {
    const screen = `${Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n")}\n❯`
    expect(await empty(bytes(screen), CLAUDE_SCREEN_MANIFEST)).toBe(true)
  })

  describe("preview", () => {
    it("names the text that is in the way, glyph and furniture stripped", async () => {
      expect(await readComposerState(claudeScreen("❯ hello world"), CLAUDE_SCREEN_MANIFEST)).toEqual({
        empty: false,
        preview: "hello world",
      })
      expect(await readComposerState(bytes(" │ > fix it            │ "), KIMI_SCREEN_MANIFEST)).toEqual({
        empty: false,
        preview: "fix it",
      })
      expect(await readComposerState(bytes("› Ask Codex to do anything"), CODEX_SCREEN_MANIFEST)).toEqual({
        empty: false,
        preview: "Ask Codex to do anything",
      })
    })

    it("is absent whenever there is nothing to preview", async () => {
      // An empty composer and an unseeable one both have no text to name;
      // emitting `preview: ""` would read as "it holds the empty string".
      expect(await readComposerState(claudeScreen("❯ "), CLAUDE_SCREEN_MANIFEST)).toEqual({ empty: true })
      expect(await readComposerState(bytes("no prompt glyph here"), CLAUDE_SCREEN_MANIFEST)).toEqual({ empty: null })
    })

    it("stays bounded when someone pastes a wall of text", async () => {
      // Two bounds stack, and the tighter one is the RENDER: the throwaway
      // terminal is 150 cols, so anything past the first row is a different
      // buffer line and never reaches the preview. The 200-char cap behind it
      // is what the API field promises independently of that width.
      const reading = await readComposerState(claudeScreen(`❯ ${"x".repeat(400)}`), CLAUDE_SCREEN_MANIFEST)
      expect(reading.empty).toBe(false)
      expect(reading.preview?.length).toBeLessThanOrEqual(200)
      expect(reading.preview?.startsWith("xxxx")).toBe(true)
    })
  })
})
