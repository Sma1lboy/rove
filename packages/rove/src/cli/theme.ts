/**
 * `rove theme list | add <source> | import [terminal] | remove <name>` — user color themes under
 * `~/.rove/themes/<name>.json`. `add` also converts terminal color scheme files (Ghostty, Kitty,
 * Alacritty TOML, WezTerm Lua/TOML, Xresources); `import` auto-detects local terminal configs.
 * `add`/`import` refuse to overwrite without `--force`; `remove` refuses bundled (read-only) names.
 *
 * Late-imported from `cli/index.ts` so the TUI startup graph doesn't load.
 * Errors are one line on stderr + exit 1, no stack: they're user errors.
 */

import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { SUBCOMMAND_VERBS } from "@sma1lboy/rove-api/cli/subcommands.ts"
import { errorMessage } from "@sma1lboy/rove-core/lib/error-message.ts"
import { expandTilde } from "@sma1lboy/rove-core/lib/path-home.ts"
import { ROVE_PRODUCT_NAME } from "@sma1lboy/rove-core/product.ts"
import { BUNDLED_THEME_JSONS } from "@sma1lboy/rove-core/theme/bundled.ts"
import {
  ThemeInstallError,
  activateUserTheme,
  isThemeName,
  parseThemeSource,
  writeUserTheme,
} from "@sma1lboy/rove-core/theme/install.ts"
import { userThemesDir } from "@sma1lboy/rove-core/theme/loader.ts"
import {
  TERMINAL_IDS,
  type TerminalId,
  detectLocalTerminalThemes,
  detectTerminalTheme,
  installDetectedTerminalTheme,
  isTerminalId,
} from "@sma1lboy/rove-core/theme/terminal-detect.ts"

const CLI_NAME = ROVE_PRODUCT_NAME

/** Short spellings accepted on the command line but not offered by completions. */
const THEME_VERB_ALIASES: Readonly<Record<string, string>> = { ls: "list", rm: "remove" }

/**
 * `bundled.ts` is only JSON imports plus a type import, so this pulls in no
 * opentui. No disk read: a published binary compiles those JSONs into the JS.
 */
const BUNDLED_NAMES: readonly string[] = Object.keys(BUNDLED_THEME_JSONS)

function fail(message: string): never {
  process.stderr.write(`${CLI_NAME} theme: ${message}\nRun ${CLI_NAME} theme --help for valid names and options.\n`)
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
  use: boolean
}

function parseAddArgs(args: string[]): { source: string; opts: AddOpts } {
  let source: string | null = null
  let name: string | undefined
  let force = false
  let use = false
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === "--force" || a === "-f") {
      force = true
      continue
    }
    if (a === "--use") {
      use = true
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
  return { source, opts: { name, force, use } }
}

async function addTheme(args: string[]): Promise<void> {
  const { source, opts } = parseAddArgs(args)
  const { text, defaultName } = await readSource(source)
  try {
    const { theme, fromScheme } = parseThemeSource(text)
    // A scheme file's extension (`.conf`, `.toml`, `.lua`, `.theme`) is not part of its name.
    const name = opts.name ?? (fromScheme ? defaultName.replace(/(.)\.[^.]+$/, "$1") : defaultName)
    const dest = writeUserTheme(name, theme, opts.force)
    if (opts.use) activateUserTheme(name)
    const suffix = `${fromScheme ? " from a terminal color scheme" : ""}${opts.use ? " (active)" : ""}`
    process.stdout.write(`installed theme "${name}"${suffix} -> ${dest}\n`)
  } catch (err) {
    if (err instanceof ThemeInstallError) fail(err.message)
    throw err
  }
}

interface ImportOpts {
  terminal?: TerminalId
  list: boolean
  name?: string
  force: boolean
  activate: boolean
}

function parseImportArgs(args: string[]): ImportOpts {
  let terminal: TerminalId | undefined
  let list = false
  let name: string | undefined
  let force = false
  let activate = true
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === "--list" || a === "-l") {
      list = true
      continue
    }
    if (a === "--force" || a === "-f") {
      force = true
      continue
    }
    if (a === "--no-use" || a === "--no-switch") {
      activate = false
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
    if (terminal === undefined) {
      const lowered = a.toLowerCase()
      if (!isTerminalId(lowered)) {
        failUsage(`unknown terminal "${a}" (expected one of: ${TERMINAL_IDS.join(", ")})`)
      }
      terminal = lowered
      continue
    }
    failUsage(`unexpected positional argument: ${a}`)
  }
  return { terminal, list, name, force, activate }
}

function importTheme(args: string[]): void {
  const opts = parseImportArgs(args)
  if (opts.list) {
    const detected = detectLocalTerminalThemes()
    if (detected.length === 0) {
      process.stdout.write("detected terminals:\n  (none)\n")
      return
    }
    const lines = ["detected terminals:"]
    for (const d of detected) {
      const font = d.scheme.fontFamily ? `  font="${d.scheme.fontFamily}"` : ""
      lines.push(`  ${d.id}  ${d.label}  ${d.configPath}${font}`)
    }
    process.stdout.write(`${lines.join("\n")}\n`)
    return
  }

  const detected = opts.terminal ? detectTerminalTheme(opts.terminal) : (detectLocalTerminalThemes()[0] ?? null)
  if (!detected) {
    const target = opts.terminal
      ? `no readable color theme found for ${opts.terminal}`
      : `no readable local terminal theme found (checked ${TERMINAL_IDS.join(", ")})`
    fail(target)
  }

  try {
    const result = installDetectedTerminalTheme(detected, {
      name: opts.name,
      force: opts.force,
      activate: opts.activate,
    })
    const fontNote = result.fontFamily ? `, font "${result.fontFamily}"` : ""
    const activeNote = result.activated ? " (active)" : ""
    process.stdout.write(
      `imported theme "${result.name}" from ${result.label} (${result.configPath})${fontNote}${activeNote} -> ${result.path}\n`,
    )
  } catch (err) {
    if (err instanceof ThemeInstallError) fail(err.message)
    throw err
  }
}

/** A name safe to join under the themes dir, or exit. Shared by both verbs so they can't drift. */
function requireThemeName(name: string | undefined): string {
  if (!isThemeName(name)) fail(`invalid theme name "${name}" (use letters, digits, '.', '_', '-')`)
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
      "  add <source> [--name <name>]  Install a theme from a URL or local path: a theme JSON,",
      "                                or a terminal color scheme (Ghostty, Kitty, Alacritty, WezTerm, Xresources)",
      "                                Pass --force to overwrite, --use to activate immediately",
      `  import [terminal]             Auto-detect and import from a local terminal (${TERMINAL_IDS.join("|")})`,
      "                                Switches Rove to the imported theme unless --no-use is passed",
      "                                Pass --list to inspect detected configs, --name <name>, --force",
      "  remove <name>                 Remove a user-installed theme",
      "",
      `User themes live under: ${userThemesDir()}`,
      "Schema: https://raw.githubusercontent.com/sma1lboy/rove/main/packages/rove/src/tui/context/theme/theme.schema.json",
      "",
    ].join("\n"),
  )
}

/** `args` is whatever followed `rove theme`. */
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
  if (verb === "import") {
    importTheme(rest)
    return
  }
  if (verb === "remove") {
    removeTheme(rest)
    return
  }
  // Unreachable today; a verb added to SUBCOMMAND_VERBS without a branch fails loud.
  failUsage(`unknown action "${action}"`)
}
