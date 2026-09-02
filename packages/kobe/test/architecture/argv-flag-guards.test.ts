/**
 * Architecture guard: argv flag checks must see the attached --flag=value form.
 *
 * `parseEngineCommand` (and `process.argv`) keep `--flag=value` as ONE token,
 * so a bare `argv.includes("--flag")` guard silently misses the attached form —
 * the recurring bug class behind double `--session-id` (claude refuses to
 * launch) and double `--append-system-prompt` injection, fixed one guard at
 * a time across three PRs (#361 → #365 → #386) before this test existed, and
 * behind `rove web --port=N` binding the default port with no error (#58).
 * The rule: presence checks go through `argvHasFlag`, value reads through
 * `flagValue` (both in src/cli/argv.ts). A check that genuinely must match
 * ONLY the bare token needs an allowlist entry here with its reason.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url))

// Files allowed to keep exact-token argv flag checks, with why.
const BARE_TOKEN_ALLOWED = new Set([
  // `kobe reset` parses user-typed process argv against a closed `known` set
  // and exit(2)s on anything else — an attached `--hard=x` is rejected as an
  // unknown argument before these checks run, so bare matching is fail-closed.
  join(SRC_ROOT, "cli", "reset-cmd.ts"),
])

// Boolean flags whose presence check may stay exact-token anywhere: an
// attached `--yes=…` form carries no meaning for them, so a user typing it
// gets nothing worse than the flag being ignored — never a wrong value.
const BOOLEAN_FLAG_ALLOWED = new Set([
  "--help", // help output
  "-h", // help output
  "--yes", // `plugin install/update`: skip the confirmation prompt
  "--all", // `plugin update`: every installed plugin
  "--routes-only", // `web`: daemon transport without static assets
  "--bridge-only", // `web`: legacy spelling of --routes-only
  "--no-takeover", // `web`: leave a running PTY server alone
])

// Rule 1 — any receiver probed with an exact-token method for a `-`-leading
// flag literal (`args.includes("--port")`, `rest.indexOf("--ref")`). The
// receiver name is deliberately unconstrained: the first version of this
// guard required it to end in `argv`, and every CLI file names it `args`.
const BARE_FLAG_LITERAL = /\.(includes|indexOf)\(\s*(["'`])(-[-\w][^"'`]*)\2/

// Rule 2 — value extraction: `indexOf` on an argv-shaped receiver, flag
// passed as anything at all (`rest.indexOf(flag)` then `rest[i + 1]`). The
// only reason to take the INDEX of a flag is to read the token after it,
// which the attached form never has. `flagValue` is the correct spelling.
const ARGV_INDEXOF = /\b(?:[\w$]*[Aa]rgv|args|rest)\.indexOf\(/

function isOffender(line: string): boolean {
  if (ARGV_INDEXOF.test(line)) return true
  const m = BARE_FLAG_LITERAL.exec(line)
  if (!m) return false
  return !(m[1] === "includes" && BOOLEAN_FLAG_ALLOWED.has(m[3]))
}

function sourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(path, files)
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path)
  }
  return files
}

describe("argv flag guards recognize the attached --flag=value form", () => {
  test("no exact-token argv flag checks outside the allowlist", () => {
    const offenders = sourceFiles(SRC_ROOT)
      .filter((file) => !BARE_TOKEN_ALLOWED.has(file))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
          .filter(({ line }) => isOffender(line))
          .map(({ i }) => `${relative(SRC_ROOT, file)}:${i + 1}`),
      )

    expect(
      offenders,
      `exact-token argv flag check misses the attached --flag=value form; use argvHasFlag / flagValue (src/cli/argv.ts) or allowlist with a reason: ${offenders.join(", ")}`,
    ).toEqual([])
  })

  test("the guard catches the shapes that escaped its first version", () => {
    expect(isOffender('const portIdx = args.indexOf("--port")')).toBe(true)
    expect(isOffender("const i = rest.indexOf(flag)")).toBe(true)
    expect(isOffender('yes: args.includes("--yes")')).toBe(false)
    expect(isOffender('const dash = version.indexOf("-")')).toBe(false)
  })

  test("the allowlisted files still exist and still contain the pattern they excuse", () => {
    for (const file of BARE_TOKEN_ALLOWED) {
      const source = readFileSync(file, "utf8")
      expect(
        source.split("\n").some((line) => isOffender(line)),
        `${relative(SRC_ROOT, file)} no longer needs its allowlist entry`,
      ).toBe(true)
    }
  })
})
