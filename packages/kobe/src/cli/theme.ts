/**
 * `kobe theme list | add <source> | remove <name>` — user color themes under
 * `~/.rove/themes/<name>.json`. `add` refuses to overwrite without `--force`;
 * `remove` refuses bundled (read-only) names.
 *
 * Late-imported from `cli/index.ts` so the TUI startup graph doesn't load.
 * Errors are one line on stderr + exit 1, no stack: they're user errors.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { errorMessage } from "@/lib/error-message"
import { expandTilde } from "../lib/path-home.ts"
import { BUNDLED_THEME_JSONS } from "../tui/context/theme/bundled"
import { userThemesDir } from "../tui/context/theme/loader"
import { validateTheme } from "../tui/context/theme/schema"
import { activeCliName } from "./rename-compat.ts"
import { SUBCOMMAND_VERBS } from "./subcommands.ts"

const CLI_NAME = activeCliName()

/** Short spellings accepted on the command line but not offered by completions. */
const THEME_VERB_ALIASES: Readonly<Record<string, string>> = { ls: "list", rm: "remove" }

/**
 * `bundled.ts` is only JSON imports plus a type import, so this pulls in no
 * opentui. No disk read: a published binary compiles those JSONs into the JS.
 */
const BUNDLED_NAMES: readonly string[] = Object.keys(BUNDLED_THEME_JSONS)

function fail(message: string): never {
  process.stderr.write(`${CLI_NAME} theme: ${message}\n`)
  process.exit(1)
}

/** Malformed invocation: error + full usage, exit 2 (vs {@link fail}'s exit 1),
 *  so an agent that guessed the shape wrong sees the usage. */
function failUsage(message: string): never {
  process.stderr.write(`${CLI_NAME} theme: ${message}\n\n`)
  printUsage()
  process.exit(2)
}

/** Sorted within each group so the output is deterministic. */
function listThemes(): void {
  const lines: string[] = []
  lines.push("bundled:")
  for (const name of [...BUNDLED_NAMES].sort()) {
    lines.push(`  ${name}  [built-in]`)
  }

  const dir = userThemesDir()
  let userFiles: string[] = []
  try {
    userFiles = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
  } catch {
    // Missing dir is normal — print "(none)" rather than warn.
  }
  lines.push("")
  lines.push(`user (${dir}):`)
  if (userFiles.length === 0) {
    lines.push("  (none)")
  } else {
    for (const f of userFiles) {
      const name = f.slice(0, -".json".length)
      const path = join(dir, f)
      const overridesBundled = BUNDLED_NAMES.includes(name) ? " (overrides built-in)" : ""
      lines.push(`  ${name}${overridesBundled}  ${path}`)
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`)
}

/** `<source>` is an http(s) URL or a path resolved against cwd. */
async function readSource(source: string): Promise<{ text: string; defaultName: string }> {
  if (/^https?:\/\//i.test(source)) {
    let res: Response
    try {
      res = await fetch(source)
    } catch (err) {
      fail(`failed to fetch ${source}: ${errorMessage(err)}`)
    }
    if (!res.ok) {
      fail(`failed to fetch ${source}: HTTP ${res.status} ${res.statusText}`)
    }
    const text = await res.text()
    // Strip query/hash so `…/foo.json?token=…` names `foo`.
    const cleanPath = source.split(/[?#]/)[0] ?? source
    const file = basename(cleanPath) || "theme.json"
    const defaultName = file.endsWith(".json") ? file.slice(0, -".json".length) : file
    return { text, defaultName }
  }
  const abs = resolve(process.cwd(), expandTilde(source))
  let text: string
  try {
    text = readFileSync(abs, "utf8")
  } catch (err) {
    fail(`failed to read ${abs}: ${errorMessage(err)}`)
  }
  const file = basename(abs)
  const defaultName = file.endsWith(".json") ? file.slice(0, -".json".length) : file
  return { text, defaultName }
}

interface AddOpts {
  name?: string
  force: boolean
}

function parseAddArgs(args: string[]): { source: string; opts: AddOpts } {
  let source: string | null = null
  let name: string | undefined
  let force = false
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === "--force" || a === "-f") {
      force = true
      continue
    }
    if (a === "--name" || a === "-n") {
      const next = args[i + 1]
      if (next === undefined) failUsage("--name requires a value")
      name = next
      i += 1
      continue
    }
    if (a.startsWith("--name=")) {
      name = a.slice("--name=".length)
      continue
    }
    if (a.startsWith("--")) failUsage(`unknown flag: ${a}`)
    if (source === null) {
      source = a
      continue
    }
    failUsage(`unexpected positional argument: ${a}`)
  }
  if (source === null) failUsage("missing <source> (URL or path to theme JSON)")
  return { source, opts: { name, force } }
}

async function addTheme(args: string[]): Promise<void> {
  const { source, opts } = parseAddArgs(args)
  const { text, defaultName } = await readSource(source)

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    fail(`source is not valid JSON: ${errorMessage(err)}`)
  }
  const result = validateTheme(parsed)
  if (!result.ok) {
    fail(`source is not a valid Rove theme: ${result.reason}`)
  }

  const name = requireThemeName(opts.name ?? defaultName)

  const dir = userThemesDir()
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, `${name}.json`)
  if (existsSync(dest) && !opts.force) {
    fail(`${dest} already exists (pass --force to overwrite)`)
  }
  // Re-serialise the validated theme: strips BOM/odd whitespace, keeps key order.
  writeFileSync(dest, `${JSON.stringify(result.theme, null, 2)}\n`, "utf8")
  process.stdout.write(`installed theme "${name}" -> ${dest}\n`)
}

/**
 * A name safe to turn into `<userThemesDir()>/<name>.json`, or exit. `join()`
 * resolves `..`, so without this `remove '../../x/notes'` would unlink a file
 * outside the themes dir. Shared by both verbs so they can't drift.
 */
function requireThemeName(name: string | undefined): string {
  if (!name || !/^[a-zA-Z0-9._-]+$/.test(name) || name === "." || name === "..") {
    fail(`invalid theme name "${name}" (use letters, digits, '.', '_', '-')`)
  }
  return name
}

function removeTheme(args: string[]): void {
  if (!args[0]) failUsage("missing <name>")
  if (args.length > 1) failUsage(`unexpected extra arguments after "${args[0]}"`)
  const name = requireThemeName(args[0])
  if (BUNDLED_NAMES.includes(name)) {
    fail(`"${name}" is a built-in theme and cannot be removed`)
  }
  const dest = join(userThemesDir(), `${name}.json`)
  if (!existsSync(dest)) {
    fail(`no user theme named "${name}" (looked for ${dest})`)
  }
  unlinkSync(dest)
  process.stdout.write(`removed theme "${name}" (${dest})\n`)
}

function printUsage(out: NodeJS.WriteStream = process.stderr): void {
  out.write(
    [
      `Usage: ${CLI_NAME} theme <command> [args]`,
      "",
      "Commands:",
      "  list                          List bundled and user-installed themes",
      "  add <source> [--name <name>]  Install a theme from a URL or local path",
      "                                Pass --force to overwrite an existing user theme",
      "  remove <name>                 Remove a user-installed theme",
      "",
      `User themes live under: ${userThemesDir()}`,
      "Schema: https://raw.githubusercontent.com/sma1lboy/rove/main/packages/kobe/src/tui/context/theme/theme.schema.json",
      "",
    ].join("\n"),
  )
}

/** `args` is whatever followed `kobe theme`. */
export async function runThemeSubcommand(args: string[]): Promise<void> {
  const [action, ...rest] = args
  if (!action || action === "--help" || action === "-h" || action === "help") {
    printUsage(action ? process.stdout : process.stderr)
    if (!action) process.exit(2)
    return
  }
  // Canonical verbs are the completion list; aliases stay local (completing both is noise).
  const verb = THEME_VERB_ALIASES[action] ?? action
  if (!SUBCOMMAND_VERBS.theme.includes(verb)) {
    failUsage(`unknown action "${action}" (try ${SUBCOMMAND_VERBS.theme.map((v) => `"${v}"`).join(", ")})`)
  }
  if (verb === "list") {
    if (rest.length > 0) failUsage(`"${action}" takes no arguments`)
    listThemes()
    return
  }
  if (verb === "add") {
    await addTheme(rest)
    return
  }
  if (verb === "remove") {
    removeTheme(rest)
    return
  }
  // Unreachable today; a verb added to SUBCOMMAND_VERBS without a branch fails loud.
  failUsage(`unknown action "${action}"`)
}
