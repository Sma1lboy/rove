#!/usr/bin/env node
/**
 * Translate one release's markdown notes into Simplified Chinese with the Claude Code CLI
 * (`claude -p`, no tools), for the `release-notes.zh.md` asset `release.yml` attaches to the
 * GitHub release. Clients in Chinese read that asset and fall back to the English body.
 *
 *   node scripts/translate-release-notes.mjs <notes.md> <out.md>
 *
 * Auth is whatever `claude` uses (CI: CLAUDE_CODE_OAUTH_TOKEN). `ROVE_NOTES_MODEL` overrides the model.
 * Exits non-zero and writes nothing when the output drops a PR reference or a code span:
 * a missing translation falls back to English, a mangled one would not.
 */

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const SYSTEM = `You translate Rove release notes (a terminal app for running AI coding sessions) from English into Simplified Chinese.
Output only the translated Markdown: no preamble, no code fence around the whole thing.
Keep the Markdown structure line for line: headings, list items, links.
Copy unchanged: link targets and PR references like [#1431](...), everything inside backticks, command lines, flags, file paths, version numbers, key names, and product names (Rove, Claude, Claude Code, Codex, TUI, Inbox, Scratch).
Translate the heading "Patch Changes" as "补丁更新", "Minor Changes" as "功能更新", "Major Changes" as "重大更新".
Write plain, natural Chinese a developer would write; do not add or drop information.`

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error("usage: translate-release-notes.mjs <notes.md> <out.md>")
  process.exit(2)
}
const notes = readFileSync(input, "utf8")
if (!notes.trim()) {
  console.error("translate-release-notes: empty notes, nothing to translate")
  process.exit(1)
}

const run = spawnSync(
  "claude",
  [
    "-p",
    "--model",
    process.env.ROVE_NOTES_MODEL || "claude-sonnet-5-5",
    "--system-prompt",
    SYSTEM,
    "--tools",
    "",
    "--output-format",
    "text",
    "--no-session-persistence",
  ],
  { input: notes, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 },
)
if (run.status !== 0) {
  console.error(`translate-release-notes: claude exited ${run.status ?? run.signal}: ${(run.stderr || "").trim()}`)
  process.exit(1)
}
const zh = run.stdout.trim()

/** Every `#123` reference and every backtick span must survive the translation verbatim. */
const kept = (pattern) => [...notes.matchAll(pattern)].map((m) => m[0]).filter((s) => !zh.includes(s))
const lost = [...kept(/#\d+\b/g), ...kept(/`[^`\n]+`/g)]
if (!zh || lost.length > 0) {
  console.error(`translate-release-notes: rejected, lost ${lost.length} reference(s): ${lost.slice(0, 5).join(" ")}`)
  process.exit(1)
}
writeFileSync(output, `${zh}\n`)
console.log(`translate-release-notes: wrote ${output} (${zh.length} chars)`)
