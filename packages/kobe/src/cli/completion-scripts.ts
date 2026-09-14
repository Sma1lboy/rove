/**
 * The three shell completion scripts, as pure functions, plus where the
 * pre-generated copies live.
 *
 * Split out of `completions-cmd.ts` so the BUILD can call the same
 * generators the CLI does: `scripts/build.ts` writes them to
 * `dist/completions/<cli>.<shell>` and ships them in the tarball. That is
 * what lets a shell `source` a file instead of paying a process start on
 * every new shell — `installCompletions` (cli/onboarding.ts) hooks that path
 * into the rc file, and `completions <shell> --path` prints it.
 *
 * Keeping this module runtime-free is the point: it imports the subcommand
 * registry and nothing else, so the build script can evaluate it without
 * dragging in the CLI graph. The one thing the generators cannot know — the
 * `api` verb list — is passed IN as {@link SubVerbs}, because that registry
 * imports every `api` handler and stays behind a lazy import at runtime.
 *
 * Both levels are DERIVED, never transcribed: the top level from
 * {@link TOP_LEVEL_SUBCOMMANDS}, the verbs from {@link SUBCOMMAND_VERBS}
 * (which the command modules themselves validate against) and, for `api`,
 * from the same `VERBS` registry `kobe api schema` enumerates.
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ProductCliName } from "../product.ts"
import { SUBCOMMAND_VERBS, TOP_LEVEL_SUBCOMMANDS } from "./subcommands.ts"

/** Shells rove generates completions for; also the install/detect vocabulary. */
export const SHELLS = ["bash", "zsh", "fish"] as const

export type ShellKind = (typeof SHELLS)[number]

/** command → its verbs, in the order each source declares them. */
export type SubVerbs = ReadonlyArray<readonly [command: string, verbs: readonly string[]]>

export function isShellKind(value: string | undefined): value is ShellKind {
  return SHELLS.some((shell) => shell === value)
}

/**
 * The pre-generated scripts, beside the bundle that reads them: `dist/completions`
 * in an installed package (every module of a split build lands in `dist/cli`),
 * `src/completions` in a source checkout — which does not exist, so a checkout
 * legitimately falls back to generating on the fly.
 */
const SHIPPED_COMPLETIONS_DIR = fileURLToPath(new URL("../completions/", import.meta.url))

/** Where the build wrote `<cli>.<shell>`; not necessarily on disk in a checkout. */
export function shippedCompletionsPath(
  shell: ShellKind,
  cliName: ProductCliName,
  dir: string = SHIPPED_COMPLETIONS_DIR,
): string {
  return join(dir, `${cliName}.${shell}`)
}

/** Every command's verbs, sorted by command: `SUBCOMMAND_VERBS` + the api verb names. */
export function mergeSubVerbs(apiVerbs: readonly string[]): SubVerbs {
  const merged: Record<string, readonly string[]> = { ...SUBCOMMAND_VERBS, api: apiVerbs }
  return Object.keys(merged)
    .sort()
    .map((command) => [command, merged[command] ?? []] as const)
}

export function generateCompletions(shell: ShellKind, cliName: ProductCliName, subVerbs: SubVerbs): string {
  return shell === "bash"
    ? generateBashCompletions(cliName, subVerbs)
    : shell === "zsh"
      ? generateZshCompletions(cliName, subVerbs)
      : generateFishCompletions(cliName, subVerbs)
}

function generateBashCompletions(cliName: ProductCliName, subVerbs: SubVerbs): string {
  const subcommands = TOP_LEVEL_SUBCOMMANDS.join(" ")
  const fn = `_${cliName}`

  return [
    `# ${cliName} bash completions`,
    `# Source: ${cliName} completions bash`,
    "",
    `${fn}() {`,
    "    local cur prev",
    "    COMPREPLY=()",
    '    cur="${COMP_WORDS[COMP_CWORD]}"',
    '    prev="${COMP_WORDS[COMP_CWORD-1]}"',
    "    if [[ ${COMP_CWORD} -eq 1 ]]; then",
    `        COMPREPLY=( $(compgen -W "${subcommands}" -- "\${cur}") )`,
    "        return",
    "    fi",
    "    if [[ ${COMP_CWORD} -eq 2 ]]; then",
    '        case "${prev}" in',
    ...subVerbs.map(
      ([command, verbs]) => `            ${command}) COMPREPLY=( $(compgen -W "${verbs.join(" ")}" -- "\${cur}") ) ;;`,
    ),
    "        esac",
    "    fi",
    "}",
    `complete -F ${fn} ${cliName}`,
    "",
  ].join("\n")
}

function generateZshCompletions(cliName: ProductCliName, subVerbs: SubVerbs): string {
  const subcommandsList = TOP_LEVEL_SUBCOMMANDS.map((s) => `"${s}"`).join(" ")
  const fn = `_${cliName}`

  return [
    `#compdef ${cliName}`,
    `# ${cliName} zsh completions`,
    `# Source: ${cliName} completions zsh`,
    "",
    `${fn}() {`,
    "    local -a subcommands verbs",
    `    subcommands=(${subcommandsList})`,
    "",
    "    if (( CURRENT == 2 )); then",
    "        _describe -t commands 'subcommand' subcommands",
    "        return",
    "    fi",
    "",
    "    verbs=()",
    '    case "${words[2]}" in',
    ...subVerbs.map(([command, verbs]) => `        ${command}) verbs=(${verbs.map((v) => `"${v}"`).join(" ")}) ;;`),
    "    esac",
    "    if (( CURRENT == 3 && ${#verbs} > 0 )); then",
    "        _describe -t verbs 'verb' verbs",
    "    fi",
    "}",
    "",
    "# Autoloaded from $fpath -> run as the completion function;",
    "# sourced directly -> register with compdef instead.",
    `if [ "\${funcstack[1]}" = "${fn}" ]; then`,
    `    ${fn} "$@"`,
    "elif (( $+functions[compdef] )); then",
    `    compdef ${fn} ${cliName}`,
    "fi",
    "",
  ].join("\n")
}

function generateFishCompletions(cliName: ProductCliName, subVerbs: SubVerbs): string {
  // `__fish_use_subcommand` keeps the top-level list from reappearing after a
  // subcommand is already typed; `__fish_seen_subcommand_from` scopes each
  // verb list to its own command.
  const lines = [
    ...TOP_LEVEL_SUBCOMMANDS.map((s) => `complete -c ${cliName} -f -n __fish_use_subcommand -a ${s}`),
    ...subVerbs.map(
      ([command, verbs]) =>
        `complete -c ${cliName} -f -n "__fish_seen_subcommand_from ${command}" -a "${verbs.join(" ")}"`,
    ),
  ]
  return `# ${cliName} fish completions\n# Source: ${cliName} completions fish\n\n${lines.join("\n")}\n`
}
