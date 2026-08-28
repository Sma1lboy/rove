/**
 * Architecture guard: engine-owned UI data (AGENTS.md).
 *
 * Neutral layers (TUI, web SPA, orchestrator, client, daemon) must not
 * embed vendor display names — name/label/placeholder copy comes from the
 * engine registry (`AIEngine.identity` → `engineDisplayName()`), so a new
 * "Ask Claude…" literal in a pane is a regression, not a style choice.
 *
 * The scan strips comments first (vendor names in prose are fine) and then
 * flags any remaining capitalized vendor word — string literals and bare
 * JSX text alike. Lowercase vendor IDs (`"claude"`) are data keys, not
 * display copy, and stay legal.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))

/** The neutral layers AGENTS.md names. `src/engine` and `src/cli` are vendor-aware by design. */
const NEUTRAL_ROOTS = [
  "packages/kobe/src/tui",
  "packages/kobe/src/tui-react",
  "packages/kobe/src/orchestrator",
  "packages/kobe/src/client",
  "packages/kobe/src/web",
  "packages/kobe-web/src",
  "packages/kobe-daemon/src",
]

const VENDOR_WORD = /\b(Claude|Codex|Copilot|Kimi)\b/

/**
 * Documented compatibility fallbacks, allowed line-by-line so the exemption
 * cannot silently widen: a hit in one of these files passes only when the
 * line contains one of its allowed fragments.
 */
const EXEMPT_LINES: Record<string, readonly string[]> = {
  // Both serve the engine-owned list; the literal pair only fires against an
  // older bridge / empty registry (see each file's header comment).
  "packages/kobe-web/src/lib/engines.ts": ['label: "Claude"', 'label: "Codex"'],
  "packages/kobe-daemon/src/daemon/web-server.ts": ['label: "Claude"'],
}

function sourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(path, files)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(path)
  }
  return files
}

/** Drop block comments, then each line's `//` tail. Good enough for a word scan. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*/, ""))
    .join("\n")
}

describe("engine-owned copy boundary", () => {
  test("neutral layers carry no vendor display names", () => {
    const offenders: string[] = []
    for (const root of NEUTRAL_ROOTS) {
      for (const file of sourceFiles(join(REPO_ROOT, root))) {
        const rel = relative(REPO_ROOT, file)
        const allowed = EXEMPT_LINES[rel] ?? []
        const lines = stripComments(readFileSync(file, "utf8")).split("\n")
        lines.forEach((line, i) => {
          if (!VENDOR_WORD.test(line)) return
          if (allowed.some((fragment) => line.includes(fragment))) return
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
        })
      }
    }
    expect(offenders, `vendor copy belongs to the engine registry:\n${offenders.join("\n")}`).toEqual([])
  })

  test("exempt fallbacks still exist where the exemption points", () => {
    for (const [rel, fragments] of Object.entries(EXEMPT_LINES)) {
      const source = readFileSync(join(REPO_ROOT, rel), "utf8")
      for (const fragment of fragments) {
        expect(source, `${rel} no longer contains "${fragment}" — drop its exemption`).toContain(fragment)
      }
    }
  })
})
