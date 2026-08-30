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
  })

  it("returns false when Codex's composer has user text", async () => {
    expect(await isComposerEmpty(bytes("› hello"), CODEX_SCREEN_MANIFEST)).toBe(false)
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
