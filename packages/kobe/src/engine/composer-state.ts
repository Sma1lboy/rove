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
/** Enough rows to capture the composer line plus a little context. */
export const COMPOSER_RENDER_ROWS = 12
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

function ruleMatches(rule: ComposerEmptyRule, region: readonly string[]): boolean {
  const haystack = region.join("\n").toLowerCase()
  if (rule.all && !rule.all.every((s) => haystack.includes(s.toLowerCase()))) return false
  if (rule.any && !rule.any.some((s) => haystack.includes(s.toLowerCase()))) return false
  if (rule.lineRegex) {
    const regexes = rule.lineRegex.map((r) => new RegExp(r, "i"))
    if (!region.some((line) => regexes.some((re) => re.test(line)))) return false
  }
  return Boolean(rule.all || rule.any || rule.lineRegex)
}

/**
 * Determine whether the engine's composer is empty.
 *
 * - `true`  = composer is empty (only prompt glyph + allowed decoration)
 * - `false` = composer has text OR the manifest exists but no rule matched
 *             (fail-closed for engines that declare rules)
 * - `null`  = no manifest / no rules (fail-open; let the A-layer gate decide)
 */
export async function isComposerEmpty(
  ringBytes: Uint8Array,
  manifest: EngineScreenManifest | undefined,
): Promise<boolean | null> {
  if (!manifest?.composerEmpty || manifest.composerEmpty.length === 0) return null
  const text = await renderRingToText(ringBytes, COMPOSER_RENDER_COLS, COMPOSER_RENDER_ROWS)
  for (const rule of manifest.composerEmpty) {
    const region = bottomRegion(text, rule.bottomLines ?? COMPOSER_BOTTOM_LINES)
    if (region.length === 0) continue
    if (ruleMatches(rule, region)) return true
  }
  return false
}
