/**
 * The state-mark vocabulary shared by the sidebar rail, tab strip, Inbox and
 * PR chip, in three presets (after oh-my-pi's symbol presets, MIT).
 *
 * `braille` is the default and the only preset font-verified for one-cell
 * advance (see `engine/spinner-frames.ts`). `starburst` spins omp's thinking
 * glyph; its dingbats fall back at uneven widths without a dingbat-capable
 * font, so it stays opt-in. `ascii` is 7-bit only.
 *
 * Per preset, spinner frames must not reuse `idle`/`unseen`/`needsInput`/
 * `attention`, or a running row reads as settled.
 */

import { DEFAULT_SPINNER_FRAMES } from "@/engine/spinner-frames"
import type { GlyphSetName } from "@/state/glyph-set"

export interface GlyphSet {
  /** Running rows; stepped by `breathGlyph`. */
  readonly spinner: readonly string[]
  /** Quiet: idle, unobserved, shell tab. */
  readonly idle: string
  /** A turn finished and nobody has looked. */
  readonly unseen: string
  /** Blocked on your answer. */
  readonly needsInput: string
  /** Needs you: error, dead engine, failed deletion. */
  readonly attention: string
  /** The tab strip's static running chip. */
  readonly running: string
  readonly done: string
  readonly rateLimited: string
  /** The engine process is gone. */
  readonly dead: string
  readonly routineFailed: string
  /** Prefix of the running-subagent count (`◇2 main`). */
  readonly subagent: string
  readonly conflict: string
  readonly checksFailing: string
  readonly checksPassing: string
  /**
   * After the title of a row whose task lives on ANOTHER machine. U+2601 is
   * East-Asian-Width Neutral and text-presentation by default (no VS16 is
   * ever appended), so wcwidth, `charWidth` and the terminal all give it one
   * cell; only an emoji-presentation fallback font could draw it wider, which
   * is why ascii keeps a 7-bit stand-in.
   */
  readonly remote: string
}

export const GLYPH_SETS: Readonly<Record<GlyphSetName, GlyphSet>> = {
  braille: {
    spinner: DEFAULT_SPINNER_FRAMES,
    idle: "○",
    unseen: "●",
    needsInput: "?",
    attention: "!",
    running: "●",
    done: "✓",
    rateLimited: "◷",
    dead: "†",
    routineFailed: "↻",
    subagent: "◇",
    conflict: "≠",
    checksFailing: "✗",
    checksPassing: "✓",
    remote: "☁",
  },
  starburst: {
    spinner: ["✻", "✼", "❉", "❊", "✺", "✹", "✸", "✶"],
    idle: "✧",
    unseen: "✦",
    needsInput: "?",
    attention: "❢",
    running: "✻",
    done: "✔",
    rateLimited: "◷",
    dead: "✞",
    routineFailed: "↻",
    subagent: "❖",
    conflict: "≠",
    checksFailing: "✘",
    checksPassing: "✔",
    remote: "☁",
  },
  ascii: {
    spinner: ["|", "/", "-", "\\"],
    idle: "o",
    unseen: "*",
    needsInput: "?",
    attention: "!",
    running: "*",
    done: "+",
    rateLimited: "~",
    dead: "x",
    routineFailed: "@",
    subagent: "&",
    conflict: "#",
    checksFailing: "x",
    checksPassing: "+",
    remote: "@",
  },
}

export const DEFAULT_GLYPHS: GlyphSet = GLYPH_SETS.braille
