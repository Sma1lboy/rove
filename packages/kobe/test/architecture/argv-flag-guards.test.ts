/**
 * Architecture guard: argv flag checks must see the attached --flag=value form.
 *
 * `parseEngineCommand` deliberately keeps `--flag=value` as ONE token, so a
 * bare `argv.includes("--flag")` guard silently misses the attached form —
 * the recurring bug class behind double `--session-id` (claude refuses to
 * launch) and double `--append-system-prompt` injection, fixed one guard at
 * a time across three PRs (#361 → #365 → #386) before this test existed.
 * The rule: any "does the command already carry this flag" check goes
 * through `argvHasFlag` (src/engine/interactive-command.ts), which matches
 * both forms. A guard that genuinely must match ONLY the bare token needs an
 * allowlist entry here with its reason.
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

// An argv-named receiver (`argv`, `baseArgv`, …) probed for a flag literal
// with an exact-token method. `argvHasFlag` is the correct spelling.
const BARE_FLAG_GUARD = /[\w$]*[Aa]rgv\.(?:includes|indexOf)\(\s*["'`]-/

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
          .filter(({ line }) => BARE_FLAG_GUARD.test(line))
          .map(({ i }) => `${relative(SRC_ROOT, file)}:${i + 1}`),
      )

    expect(
      offenders,
      `exact-token argv flag check misses the attached --flag=value form; use argvHasFlag (src/engine/interactive-command.ts) or allowlist with a reason: ${offenders.join(", ")}`,
    ).toEqual([])
  })

  test("the allowlisted files still exist and still contain the pattern they excuse", () => {
    for (const file of BARE_TOKEN_ALLOWED) {
      const source = readFileSync(file, "utf8")
      expect(BARE_FLAG_GUARD.test(source), `${relative(SRC_ROOT, file)} no longer needs its allowlist entry`).toBe(true)
    }
  })
})
