#!/usr/bin/env node
/**
 * Keeps rove-web moving onto Tailwind + src/ui (docs/DESIGN.md §6, the rove-ui skill §0). Three ratchets on a diff:
 *  1. the legacy .css sheets only shrink, and no new sheet appears; styles.css takes no new selector beyond its tokens,
 *     reset, scrollbars and xterm internals;
 *  2. no net new raw <button> / checkbox outside src/ui: use Button, or add the variant there;
 *  3. arbitrary Tailwind values (`px-[13px]`, `text-[#fff]`) live in src/ui only: elsewhere use a token utility.
 * A line that must break rule 2 or 3 carries `ui-ok: <reason>`.
 *
 * Usage: node scripts/web-ui-gate.mjs [range]   (default origin/main...HEAD)
 */
import { execFileSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"

const WEB = "packages/rove-web/src/"
const UI = `${WEB}ui/`
const RAW_CONTROL = /<button\b|<input\s[^>]*type="checkbox"/g
// What styles.css still holds: tokens, the element reset, scrollbars, xterm internals, and the at-rules around them.
const STYLES_KEEP = /^\s*(:root|\*|html|body|button|input|textarea|select|::?-webkit-scrollbar|\.xterm|\.term-host|@)/
const ARBITRARY = /(?:^|[\s"'`:])-?[a-z][\w-]*-\[[^\]\s]+\]/

/** `diff` is `git diff -U0` output; `added` the paths it adds. Returns the rule breaks, empty when clean. */
export function check(diff, added = []) {
  const errors = []
  let file = null
  let cssDelta = 0
  let controls = 0
  for (const line of diff.split("\n")) {
    // A deleted file's diff names it only on the `---` line (`+++ /dev/null`).
    if (line.startsWith("--- ")) file = line.slice(4).replace(/^a\//, "")
    if (line.startsWith("+++ ") && line !== "+++ /dev/null") file = line.slice(4).replace(/^b\//, "")
    if (/^(\+\+\+|---) /.test(line) || !file?.startsWith(WEB) || !/^[+-]/.test(line)) continue
    const sign = line[0] === "+" ? 1 : -1
    const text = line.slice(1)
    if (file.endsWith(".css") && !file.endsWith("/tailwind.css")) cssDelta += sign
    if (sign > 0 && file.endsWith("/styles.css") && /[{,]\s*$/.test(text) && !STYLES_KEEP.test(text))
      errors.push(`${file}: new rule in styles.css (tokens, reset and xterm only): ${text.trim()}`)
    if (!/\.tsx?$/.test(file) || file.startsWith(UI) || text.includes("ui-ok:")) continue
    controls += sign * (text.match(RAW_CONTROL)?.length ?? 0)
    if (sign > 0 && ARBITRARY.test(text)) errors.push(`${file}: arbitrary value outside src/ui: ${text.trim()}`)
  }
  for (const f of added) {
    if (f.startsWith(WEB) && f.endsWith(".css") && !f.endsWith("/tailwind.css"))
      errors.push(`${f}: new stylesheet; style new UI with Tailwind`)
  }
  if (cssDelta > 0)
    errors.push(`legacy CSS grew by ${cssDelta} lines: use Tailwind utilities or a src/ui component instead`)
  if (controls > 0)
    errors.push(
      `${controls} new raw <button>/checkbox outside src/ui: use src/ui/button.tsx (add a variant there if none fits)`,
    )
  return errors
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const range = process.argv[2] ?? "origin/main...HEAD"
  const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20 })
  const added = git(["diff", "--name-only", "--diff-filter=A", range, "--", WEB]).split("\n")
  const errors = check(git(["diff", "-U0", range, "--", WEB]), added)
  for (const e of errors) console.error(e)
  if (errors.length) console.error("rove-web UI rules: .claude/skills/rove-ui/SKILL.md §0")
  process.exit(errors.length ? 1 : 0)
}
