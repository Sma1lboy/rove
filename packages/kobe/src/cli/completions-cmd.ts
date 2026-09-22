/**
 * `<cli> completions` — generate shell completion scripts, or point at the
 * pre-generated copy shipped in the package.
 *
 * Usage:
 *   source <(kobe completions zsh)                 # zsh, generate now
 *   kobe completions zsh --path                    # print the shipped file's path
 *   kobe completions zsh --install                 # hook that path into your rc
 *   kobe completions zsh  > ~/.zsh/completions/_kobe   # zsh, fpath install
 *   kobe completions bash > ~/.bash_completion.d/kobe
 *   kobe completions fish > ~/.config/fish/completions/kobe.fish
 *
 * `--path`: generating costs a process start (~0.3s per shell, node → bun) for
 * static text, so the build bakes `dist/completions/<cli>.<shell>` for
 * `installCompletions` to source. A checkout has no dist: generation runs on
 * the fly and `--path` fails loudly.
 *
 * The zsh script works from `$fpath` (`#compdef`) or sourced (self-`compdef`;
 * a funcstack guard tells them apart). Two levels complete — subcommand and
 * its verb; flags are omitted since subcommands define their own.
 */
import { existsSync, readFileSync } from "node:fs"
import type { ProductCliName } from "../product.ts"
import { generateCompletions, isShellKind, mergeSubVerbs, shippedCompletionsPath } from "./completion-scripts.ts"
import { activeCliName } from "./rename-compat.ts"

/** `--help` is spelled as a flag or as a bare word, as it always was here. */
const HELP_WORDS = ["--help", "-h", "help"]

/** Seams for the tests: the real shipped directory, and the real home. */
export interface CompletionsCommandDeps {
  readonly shippedDir?: string
  readonly home?: string
}

function completionUsage(cliName: ProductCliName): string {
  return [
    `Usage: ${cliName} completions <bash|zsh|fish> [--path|--install]`,
    "",
    `Print a shell completion script for ${cliName}, or locate the copy shipped`,
    "with this install.",
    "",
    `  ${cliName} completions zsh --path      print the shipped script's path`,
    `  ${cliName} completions zsh --install   hook it into your shell config`,
    "",
    "Install:",
    `  zsh   source <(${cliName} completions zsh)     # one-off, or in ~/.zshrc after compinit`,
    "        # with no process start per shell — what the first-run wizard writes:",
    `        #   ${cliName} completions zsh --install`,
    `  bash  ${cliName} completions bash --install    # appends to ~/.bashrc`,
    `  fish  ${cliName} completions fish --install    # writes ~/.config/fish/completions/${cliName}.fish`,
    "        # the manual way, any shell:",
    `        #   ${cliName} completions zsh > ~/.zsh/completions/_${cliName}`,
    "        #   fpath=(~/.zsh/completions $fpath)   # in ~/.zshrc, BEFORE compinit",
    "        #   rm -f ~/.zcompdump && exec zsh      # rebuild the completion cache",
    "",
  ].join("\n")
}

export async function runCompletionsSubcommand(
  rest: readonly string[],
  cliName: ProductCliName = activeCliName(),
  deps: CompletionsCommandDeps = {},
): Promise<void> {
  const usage = completionUsage(cliName)
  const fail: (message: string) => never = (message) => {
    process.stderr.write(`${cliName} completions: ${message}\n\n${usage}`)
    process.exit(2)
  }

  if (rest.some((arg) => HELP_WORDS.includes(arg))) {
    process.stdout.write(usage)
    return
  }

  const flags = rest.filter((arg) => arg.startsWith("-"))
  const shells = rest.filter((arg) => !arg.startsWith("-"))
  const unknownFlag = flags.find((flag) => flag !== "--path" && flag !== "--install")
  if (unknownFlag) fail(`unknown option "${unknownFlag}"`)
  if (new Set(flags).size > 1) fail("--path and --install are different things; pass one")
  const shell = shells.length === 1 ? shells[0] : undefined
  if (!isShellKind(shell)) fail(`unknown shell "${shells.join(" ")}"`)

  const scriptPath = shippedCompletionsPath(shell, cliName, deps.shippedDir)
  const shipped = existsSync(scriptPath) ? scriptPath : null

  if (flags[0] === "--path") {
    if (!shipped) {
      fail(
        `no pre-generated ${shell} script at ${scriptPath}\n` +
          `${cliName} completions ${shell}    # print the script to stdout instead`,
      )
    }
    process.stdout.write(`${shipped}\n`)
    return
  }

  if (flags[0] === "--install") {
    // Lazy: a static import would make every `completions <shell>` load i18n
    // and the onboarding graph.
    const [{ installCompletions }, { t }] = await Promise.all([import("./onboarding.ts"), import("../tui/i18n")])
    const completion = installCompletions(shell, deps.home, cliName, shipped)
    const line = completion.installed ? "onboarding.appliedCompletions" : "onboarding.keptCompletions"
    process.stdout.write(`${t(line, { path: completion.path })}\n`)
    return
  }

  // Serve the shipped file so `--path` and stdout can never disagree.
  if (shipped) {
    process.stdout.write(readFileSync(shipped, "utf8"))
    return
  }
  const { API_VERBS } = await import("./api/verbs.ts")
  process.stdout.write(generateCompletions(shell, cliName, mergeSubVerbs(API_VERBS)))
}
