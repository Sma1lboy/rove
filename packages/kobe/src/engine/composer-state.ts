/**
 * Composer-empty detection for hosted engine sessions.
 *
 * The delivery gate (issue #78) needs to know whether the engine's composer
 * already contains user text before auto-pasting a peer/API message. This is
 * a pure function: raw ring bytes + an engine-owned manifest → empty / not
 * empty / unknown. No real PTY is started; rendering happens in a throwaway
 * headless xterm at a fixed width.
 */

import { Unicode11Addon } from "@xterm/addon-unicode11"
import { Terminal as XtermHeadless } from "@xterm/headless"
import type { ComposerEmptyRule, EngineScreenManifest } from "./screen-state.ts"

/** Fixed width for composer rendering — see issue #78. Claude's composer
 *  line is stable across 150–236 cols; 150 is enough and cheap. */
export const COMPOSER_RENDER_COLS = 150
/**
 * Rows the throwaway terminal renders into.
 *
 * Must exceed a real engine screen, not just the footer we want to read. At
 * 12 the ring's own line count overran the buffer and lines CONCATENATED
 * (`──⏵⏵ bypass permissions on …` — a rule and the hint row fused into one),
 * so the composer line was not merely off-window, it no longer existed as a
 * line to match. Every Claude delivery then read as "composer has text" and
 * deferred, whatever the composer actually held.
 *
 * 60 covers a full-screen engine with headroom. The cost is one throwaway
 * xterm per delivery gate, which is already the price of the render.
 */
export const COMPOSER_RENDER_ROWS = 60
/** Default trailing lines to inspect for the composer prompt. */
export const COMPOSER_BOTTOM_LINES = 3

/** Render raw PTY ring bytes to plain text via headless xterm. */
function renderRingToText(bytes: Uint8Array, cols: number, rows: number): Promise<string> {
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
      const lines: string[] = []
      for (let y = 0; y < active.length; y++) {
        const line = active.getLine(y)
        lines.push(line?.translateToString(true) ?? "")
      }
      term.dispose()
      resolve(lines.join("\n"))
    })
  })
}

function bottomRegion(captureText: string, lines: number): readonly string[] {
  const nonEmpty = captureText.split("\n").filter((l) => l.trim().length > 0)
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
 * The third outcome is the one that matters. Collapsing it into `text` is
 * what turned a Claude layout change into a total delivery outage: the prompt
 * glyph moved out of the inspected window, no rule matched, and every message
 * to every Claude task deferred as "composer busy" — including the ones whose
 * composers were plainly empty. "I could not see it" is not evidence of text.
 */
type RuleOutcome = "empty" | "text" | "absent"

function ruleOutcome(rule: ComposerEmptyRule, region: readonly string[]): RuleOutcome {
  const haystack = region.join("\n").toLowerCase()
  // `all`/`any` are ANCHORS — the prompt glyph that says "the composer is on
  // this screen". Missing them means the region does not show the composer.
  if (rule.all && !rule.all.every((s) => haystack.includes(s.toLowerCase()))) return "absent"
  if (rule.any && !rule.any.some((s) => haystack.includes(s.toLowerCase()))) return "absent"
  // Anchored: the line shape decides empty vs typed-into.
  if (rule.lineRegex) {
    const regexes = rule.lineRegex.map((r) => new RegExp(r, "i"))
    if (!region.some((line) => regexes.some((re) => re.test(line)))) return "text"
  }
  return rule.all || rule.any || rule.lineRegex ? "empty" : "absent"
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
  const text = await renderRingToText(ringBytes, COMPOSER_RENDER_COLS, COMPOSER_RENDER_ROWS)
  let sawComposer = false
  for (const rule of manifest.composerEmpty) {
    const region = bottomRegion(text, rule.bottomLines ?? COMPOSER_BOTTOM_LINES)
    if (region.length === 0) continue
    const outcome = ruleOutcome(rule, region)
    if (outcome === "empty") return true
    if (outcome === "text") sawComposer = true
  }
  // Some rule found the composer and read text in it; nobody found it empty.
  return sawComposer ? false : null
}
