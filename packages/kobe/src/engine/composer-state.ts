/**
 * Composer-empty detection for hosted engine sessions.
 *
 * The delivery gate needs to know whether the engine's composer
 * already contains user text before auto-pasting a peer/API message. This is
 * a pure function: raw ring bytes + an engine-owned manifest → empty / not
 * empty / unknown. No real PTY is started; rendering happens in a throwaway
 * headless xterm at a fixed width.
 */

import { Unicode11Addon } from "@xterm/addon-unicode11"
import { Terminal as XtermHeadless } from "@xterm/headless"
import type { ComposerEmptyRule, EngineScreenManifest } from "./screen-state.ts"

/** Fixed width for composer rendering. Claude's composer
 *  line is stable across 150–236 cols; 150 is enough and cheap. */
const COMPOSER_RENDER_COLS = 150
/**
 * Rows the throwaway terminal renders into.
 *
 * Must exceed a real engine screen, not just the footer we want to read. Too
 * few rows and the ring's own line count overruns the buffer, fusing lines
 * together (`──⏵⏵ bypass permissions on …` — a rule and the hint row in one),
 * so the composer line does not exist as a line to match at all and every
 * delivery reads as "composer has text", whatever the composer holds.
 *
 * 60 covers a full-screen engine with headroom. The cost is one throwaway
 * xterm per delivery gate, which is already the price of the render.
 */
const COMPOSER_RENDER_ROWS = 60
/** Default trailing lines to inspect for the composer prompt. */
const COMPOSER_BOTTOM_LINES = 3

interface RenderedComposerLine {
  readonly text: string
  /** Same cells as `text`, with non-dim glyphs blanked out. */
  readonly dimmedText: string
}

/** Render raw PTY ring bytes and retain the one style bit composer manifests use. */
function renderRing(bytes: Uint8Array, cols: number, rows: number): Promise<readonly RenderedComposerLine[]> {
  const term = new XtermHeadless({
    allowProposedApi: true,
    cols,
    rows,
    scrollback: rows,
  })
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = "11"
  return new Promise((resolve) => {
    term.write(bytes, () => {
      const active = term.buffer.active
      const lines: RenderedComposerLine[] = []
      for (let y = 0; y < active.length; y++) {
        const line = active.getLine(y)
        if (!line) {
          lines.push({ text: "", dimmedText: "" })
          continue
        }
        let dimmedText = ""
        for (let x = 0; x < line.length; x++) {
          const cell = line.getCell(x)
          if (!cell || cell.getWidth() === 0) continue
          const chars = cell.getChars() || " "
          dimmedText += cell.isDim() ? chars : " ".repeat(Array.from(chars).length)
        }
        lines.push({ text: line.translateToString(true), dimmedText: dimmedText.trimEnd() })
      }
      term.dispose()
      resolve(lines)
    })
  })
}

function bottomRegion(capture: readonly RenderedComposerLine[], lines: number): readonly RenderedComposerLine[] {
  const nonEmpty = capture.filter((line) => line.text.trim().length > 0)
  return nonEmpty.slice(-lines)
}

/**
 * How a rule fared against one screen region.
 *
 *   `empty`  — the composer is there and holds nothing.
 *   `text`   — the composer is there and holds something.
 *   `absent` — its ANCHOR is not on screen at all, so this rule saw no
 *              composer and has nothing to say about one.
 *
 * The third outcome is the one that matters. Collapsing it into `text` turns
 * any engine layout change into a total delivery outage: the prompt glyph
 * moves out of the inspected window, no rule matches, and every message to
 * that engine defers as "composer busy" — including the ones whose composers
 * are plainly empty. "I could not see it" is not evidence of text.
 */
type RuleOutcome = "empty" | "text" | "absent"

function ruleOutcome(rule: ComposerEmptyRule, region: readonly RenderedComposerLine[]): RuleOutcome {
  const haystack = region
    .map((line) => line.text)
    .join("\n")
    .toLowerCase()
  // `all`/`any` are ANCHORS — the prompt glyph that says "the composer is on
  // this screen". Missing them means the region does not show the composer.
  if (rule.all && !rule.all.every((s) => haystack.includes(s.toLowerCase()))) return "absent"
  if (rule.any && !rule.any.some((s) => haystack.includes(s.toLowerCase()))) return "absent"
  // Anchored: the line shape decides empty vs typed-into.
  if (rule.lineRegex) {
    const regexes = rule.lineRegex.map((r) => new RegExp(r, "i"))
    if (!region.some((line) => regexes.some((re) => re.test(line.text)))) return "text"
  }
  if (rule.dimmed) {
    const dimmedHaystack = region
      .map((line) => line.dimmedText)
      .join("\n")
      .toLowerCase()
    if (!rule.dimmed.every((text) => dimmedHaystack.includes(text.toLowerCase()))) return "text"
  }
  return rule.all || rule.any || rule.lineRegex || rule.dimmed ? "empty" : "absent"
}

/**
 * Determine whether the engine's composer is empty.
 *
 * - `true`  = composer is empty (only prompt glyph + allowed decoration)
 * - `false` = the composer is on screen and holds text — fail-closed, do not
 *             paste over what someone is writing
 * - `null`  = no manifest / no rules, OR no rule's anchor appeared at all
 *             (we cannot see the composer; the A-layer quiet period decides)
 *
 * The `null`-on-absent case is deliberate and load-bearing. These rules are
 * coupled to how an engine draws itself TODAY, so a UI change upstream will
 * eventually stop matching. When it does, the honest answer is "I don't
 * know", which leaves the A-layer's recent-human-write window as the guard —
 * not "assume text forever", which silently blocks every delivery to that
 * engine with no signal that anything is wrong.
 */
export async function isComposerEmpty(
  ringBytes: Uint8Array,
  manifest: EngineScreenManifest | undefined,
): Promise<boolean | null> {
  if (!manifest?.composerEmpty || manifest.composerEmpty.length === 0) return null
  const capture = await renderRing(ringBytes, COMPOSER_RENDER_COLS, COMPOSER_RENDER_ROWS)
  let sawComposer = false
  for (const rule of manifest.composerEmpty) {
    const region = bottomRegion(capture, rule.bottomLines ?? COMPOSER_BOTTOM_LINES)
    if (region.length === 0) continue
    const outcome = ruleOutcome(rule, region)
    if (outcome === "empty") return true
    if (outcome === "text") sawComposer = true
  }
  // Some rule found the composer and read text in it; nobody found it empty.
  return sawComposer ? false : null
}
