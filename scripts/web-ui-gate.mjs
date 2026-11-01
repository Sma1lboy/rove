#!/usr/bin/env node
/**
 * Keeps rove-web on Tailwind + src/ui (docs/DESIGN.md §6, the rove-ui skill §0). Three rules:
 *  1. tailwind.css is the only stylesheet, and it takes no new selector beyond tokens, the element reset, scrollbars,
 *     xterm internals and Tailwind at-rules: a component's look lives in its TSX or a src/ui recipe;
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
const SHEET = `${WEB}tailwind.css`
const RAW_CONTROL = /<button\b|<input\s[^>]*type="checkbox"/g
// Selectors tailwind.css may gain: tokens, the reset, scrollbars, xterm internals, at-rules and their nested blocks.
const SHEET_KEEP =
  /^\s*(:root|\*|html|body|#root|button|input|textarea|select|::?-webkit-scrollbar|\.xterm|\.term-host|@|&|from\b|to\b|\d+%)/
const ARBITRARY = /(?:^|[\s"'`:])-?[a-z][\w-]*-\[[^\]\s]+\]/

/** `diff` is `git diff -U0` output; `sheets` the .css files under src at the head. Returns the rule breaks. */
export function check(diff, sheets = []) {
  const errors = sheets
    .filter((f) => f.startsWith(WEB) && f !== SHEET)
    .map((f) => `${f}: a stylesheet besides tailwind.css; style it with Tailwind in the TSX or a src/ui recipe`)
  let file = null
  let controls = 0
  for (const line of diff.split("\n")) {
    if (line.startsWith("--- ")) file = line.slice(4).replace(/^a\//, "")
    if (line.startsWith("+++ ") && line !== "+++ /dev/null") file = line.slice(4).replace(/^b\//, "")
    if (/^(\+\+\+|---) /.test(line) || !file?.startsWith(WEB) || !/^[+-]/.test(line)) continue
    const sign = line[0] === "+" ? 1 : -1
    const text = line.slice(1)
    if (sign > 0 && file === SHEET && /[{,]\s*$/.test(text) && !SHEET_KEEP.test(text))
      errors.push(`${file}: new rule (tokens, reset, scrollbars and xterm only): ${text.trim()}`)
    if (!/\.tsx?$/.test(file) || file.startsWith(UI) || text.includes("ui-ok:")) continue
    controls += sign * (text.match(RAW_CONTROL)?.length ?? 0)
    if (sign > 0 && ARBITRARY.test(text)) errors.push(`${file}: arbitrary value outside src/ui: ${text.trim()}`)
  }
  if (controls > 0)
    errors.push(
      `${controls} new raw <button>/checkbox outside src/ui: use src/ui/button.tsx (add a variant there if none fits)`,
    )
  return errors
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const range = process.argv[2] ?? "origin/main...HEAD"
  const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20 })
  const head = range.includes("..") ? range.split(/\.{2,3}/)[1] || "HEAD" : "HEAD"
  const sheets = git(["ls-tree", "-r", "--name-only", head, "--", WEB]).split("\n").filter((f) => f.endsWith(".css"))
  const errors = check(git(["diff", "-U0", range, "--", WEB]), sheets)
  for (const e of errors) console.error(e)
  if (errors.length) console.error("rove-web UI rules: .claude/skills/rove-ui/SKILL.md §0")
  process.exit(errors.length ? 1 : 0)
}
