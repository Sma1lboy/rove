#!/usr/bin/env node
/**
 * Bare `console.error` as a catch handler is invisible in the TUI: the app
 * runs under an alternate screen, so the line only ever reaches the daemon log
 * and the failed gesture looks like a no-op. This gate keeps `tui-react/**`
 * free of the pattern — Biome can't express "console.error inside a catch", so
 * it lives here beside the other repo-specific gates (file-size-check.sh,
 * check-changeset.mjs, coverage-gate.mjs).
 *
 * Fix a hit by adding the on-screen half (notifyError / notif.notify) and
 * keeping the console line for forensics. A genuinely-invisible-by-design case
 * (focus bookkeeping, telemetry) takes a `// silent-catch-ok: <reason>` marker
 * on the offending line or the one above it.
 *
 * Behavior is covered by test/architecture/no-silent-catch.test.ts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const root = process.argv[2] ?? "packages/kobe/src/tui-react"

/** Every .ts/.tsx file under `dir`, recursively. */
function sources(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (/\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

const CATCH_ARROW = /\.catch\s*\(.*=>\s*console\.error/
const CATCH_BLOCK_OPEN = /\bcatch\s*(\([^)]*\))?\s*\{\s*$/
const MARKER = /silent-catch-ok/

/**
 * Pre-existing block-form hits outside this gate's introducing change. Both
 * are teardown paths with no UI left to render a toast into (quit, and the kv
 * full-wipe write). They are listed here rather than marked in place because
 * those files belong to other in-flight slices; the next person to touch
 * either should add the `silent-catch-ok` marker there and drop the entry.
 * Keyed by FILE, not line: a line number goes stale on the first edit above
 * it and the exemption would lapse without anyone noticing.
 */
const GRANDFATHERED = new Set([
  "packages/kobe/src/tui-react/context/kv-core.ts",
  "packages/kobe/src/tui-react/workspace/host-keybindings.ts",
])

const hits = []
for (const file of sources(root)) {
  const lines = readFileSync(file, "utf8").split("\n")
  lines.forEach((line, i) => {
    // Shape 1: one-expression arrow handler, `.catch(e => console.error(…))`.
    const offending = CATCH_ARROW.test(line)
    // Shape 2: a catch block whose ONLY statement is the log — nothing else
    // in the block surfaces the failure. (A block that also notifies is fine,
    // which is exactly the fix, so the closing-brace check is the point.)
    if (!offending && CATCH_BLOCK_OPEN.test(line)) {
      const body = lines[i + 1] ?? ""
      const after = lines[i + 2] ?? ""
      if (body.includes("console.error") && /^\s*\}/.test(after)) {
        if (!MARKER.test(body) && !MARKER.test(line)) hits.push({ file, line: i + 2 })
        return
      }
    }
    if (!offending) return
    // Escape hatch: marker on the line itself or the one directly above.
    if (MARKER.test(line) || MARKER.test(lines[i - 1] ?? "")) return
    hits.push({ file, line: i + 1 })
  })
}

const live = hits.filter((hit) => !GRANDFATHERED.has(hit.file))
for (const hit of live) {
  console.log(
    `::error file=${hit.file},line=${hit.line}::bare console.error in a catch handler — invisible under the alternate screen. Add the on-screen half (notifyError/notif.notify) alongside it, or mark it '// silent-catch-ok: <reason>'.`,
  )
}
if (live.length > 0) {
  console.log("\nSilent failures are the most-repeated defect class in this tree — see AGENTS.md.")
  process.exit(1)
}
console.log(`no-silent-catch OK — no bare console.error catch handlers under ${root}`)
