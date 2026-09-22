/**
 * Shell completion scripts as pure functions, plus where pre-generated copies
 * live. `scripts/build.ts` writes them to `dist/completions/<cli>.<shell>` so a
 * shell `source`s a file instead of starting a process per shell.
 *
 * Must stay runtime-free (imports only the subcommand registry) so the build
 * can evaluate it. The `api` verb list is passed IN as {@link SubVerbs}: that
 * registry imports every handler and stays lazy at runtime. Everything is
 * DERIVED from {@link TOP_LEVEL_SUBCOMMANDS}, {@link SUBCOMMAND_VERBS} and the
 * `VERBS` registry, never transcribed.
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

/** `dist/completions` when installed; `src/completions` in a checkout, which
 *  doesn't exist, so a checkout generates on the fly. */
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
  // `__fish_use_subcommand`: top level only before a subcommand is typed.
  const lines = [
    ...TOP_LEVEL_SUBCOMMANDS.map((s) => `complete -c ${cliName} -f -n __fish_use_subcommand -a ${s}`),
    ...subVerbs.map(
      ([command, verbs]) =>
        `complete -c ${cliName} -f -n "__fish_seen_subcommand_from ${command}" -a "${verbs.join(" ")}"`,
    ),
  ]
  return `# ${cliName} fish completions\n# Source: ${cliName} completions fish\n\n${lines.join("\n")}\n`
}
