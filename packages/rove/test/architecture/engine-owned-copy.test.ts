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
  "packages/rove/src/tui",
  "packages/rove/src/tui-react",
  "packages/rove/src/orchestrator",
  "packages/rove/src/client",
  "packages/rove-harness/src",
  "packages/rove-daemon/src",
]

const VENDOR_WORD = /\b(Claude|Codex|Copilot|Kimi)\b/

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

function vendorCopyOffenders(): string[] {
  return NEUTRAL_ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root))).flatMap((file) =>
    stripComments(readFileSync(file, "utf8"))
      .split("\n")
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => VENDOR_WORD.test(line))
      .map(({ line, i }) => `${relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`),
  )
}

describe("engine-owned copy boundary", () => {
  test("neutral layers carry no vendor display names", () => {
    const offenders = vendorCopyOffenders()
    expect(offenders, `vendor copy belongs to the engine registry:\n${offenders.join("\n")}`).toEqual([])
  })
})
