/**
 * `<cli> completions` — generate shell completion scripts.
 *
 * Usage:
 *   source <(kobe completions zsh)                 # zsh, one-off or in ~/.zshrc
 *   kobe completions zsh  > ~/.zsh/completions/_kobe   # zsh, fpath install
 *   kobe completions bash > ~/.bash_completion.d/kobe
 *   kobe completions fish > ~/.config/fish/completions/kobe.fish
 *
 * The zsh script works both ways: dropped into `$fpath` it is a normal
 * `#compdef` autoload file; sourced directly it registers itself via
 * `compdef` (the funcstack guard at the end tells the two apart).
 *
 * The generated scripts complete two levels — the top-level subcommand and,
 * for the commands that take one, its verb (`kobe daemon <TAB>` →
 * `start stop status restart`). Flags are omitted because most subcommands
 * define their own.
 *
 * Both levels are DERIVED, never transcribed: the top level from
 * {@link TOP_LEVEL_SUBCOMMANDS}, the verbs from {@link SUBCOMMAND_VERBS}
 * (which the command modules themselves validate against) and, for `api`,
 * from the same `VERBS` registry `kobe api schema` enumerates. That registry
 * is loaded lazily so `completions` stays the only command that pays for it.
 */
import type { ProductCliName } from "../product.ts"
import { activeCliName } from "./rename-compat.ts"
import { SUBCOMMAND_VERBS, TOP_LEVEL_SUBCOMMANDS } from "./subcommands.ts"

/** command → its verbs, in the order each source declares them. */
type SubVerbs = ReadonlyArray<readonly [command: string, verbs: readonly string[]]>

async function collectSubVerbs(): Promise<SubVerbs> {
  const { API_VERBS } = await import("./api/verbs.ts")
  const merged: Record<string, readonly string[]> = { ...SUBCOMMAND_VERBS, api: API_VERBS }
  return Object.keys(merged)
    .sort()
    .map((command) => [command, merged[command] ?? []] as const)
}

function completionUsage(cliName: ProductCliName): string {
  return [
    `Usage: ${cliName} completions <bash|zsh|fish>`,
    "",
    `Generate a shell completion script for ${cliName} and print it to stdout.`,
    "",
    "Install:",
    `  zsh   source <(${cliName} completions zsh)     # one-off, or in ~/.zshrc after compinit`,
    "        # or the fpath way:",
    `        #   ${cliName} completions zsh > ~/.zsh/completions/_${cliName}`,
    "        #   fpath=(~/.zsh/completions $fpath)   # in ~/.zshrc, BEFORE compinit",
    "        #   rm -f ~/.zcompdump && exec zsh      # rebuild the completion cache",
    `  bash  ${cliName} completions bash > ~/.bash_completion.d/${cliName}   # source it from ~/.bashrc`,
    `  fish  ${cliName} completions fish > ~/.config/fish/completions/${cliName}.fish`,
    "",
  ].join("\n")
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

export async function runCompletionsSubcommand(
  rest: readonly string[],
  cliName: ProductCliName = activeCliName(),
): Promise<void> {
  const shell = rest[0]
  const usage = completionUsage(cliName)

  if (shell === "--help" || shell === "-h" || shell === "help") {
    process.stdout.write(usage)
    return
  }

  if (!shell || (shell !== "bash" && shell !== "zsh" && shell !== "fish")) {
    process.stderr.write(`${cliName} completions: unknown shell "${shell}"\n\n${usage}`)
    process.exit(2)
  }

  const subVerbs = await collectSubVerbs()

  let script: string
  if (shell === "bash") {
    script = generateBashCompletions(cliName, subVerbs)
  } else if (shell === "zsh") {
    script = generateZshCompletions(cliName, subVerbs)
  } else {
    script = generateFishCompletions(cliName, subVerbs)
  }

  process.stdout.write(script)
}
