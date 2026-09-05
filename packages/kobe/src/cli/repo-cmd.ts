/**
 * `kobe repo <show|set|unset> [path]` — manage a repo's per-user init
 * override (the `initScript` / `initPrompt` stored in state.json).
 *
 * This override is the FALLBACK default for a repo that doesn't ship its
 * own `.rove/init.sh` / `.rove/init-prompt.md`; legacy `.kobe/` files remain
 * fallbacks and in-repo files win when
 * present (see `state/repo-init.ts`). The path defaults to the current
 * directory and is normalized to its git toplevel, so every worktree of
 * the repo resolves the same entry.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { errorMessage } from "@/lib/error-message"
import { expandTilde } from "../lib/path-home.ts"
import { activeCliName } from "./rename-compat.ts"
import { SUBCOMMAND_VERBS } from "./subcommands.ts"

const CLI_NAME = activeCliName()

const REPO_USAGE = [
  `Usage: ${CLI_NAME} repo <show|set|unset> [path] [options]`,
  "",
  "Manage a repo's per-user init override (state.json fallback for repos",
  "that don't ship .rove/init.sh / .rove/init-prompt.md).",
  "",
  "Commands:",
  "  show [path]                 Print the override + repo convention files",
  "  set [path] <options>        Set the init script and/or first prompt",
  "  unset [path] [--init-script] [--init-prompt]   Clear one or both (default: both)",
  "",
  "Set options (later wins; *-file reads from disk):",
  "  --init-script <text>        Inline shell to run before the engine",
  "  --init-script-file <path>   Read the init script from a file",
  "  --init-prompt <text>        Inline first prompt for the engine",
  "  --init-prompt-file <path>   Read the first prompt from a file",
  "",
  "  path defaults to the current directory (resolved to its git toplevel).",
  "",
].join("\n")

function usageError(message: string): never {
  process.stderr.write(`${CLI_NAME} repo: ${message}\n\n${REPO_USAGE}\n`)
  process.exit(2)
}

function readArgFile(path: string): string {
  try {
    return readFileSync(resolve(process.cwd(), expandTilde(path)), "utf8")
  } catch (err) {
    usageError(`cannot read ${path}: ${errorMessage(err)}`)
  }
}

/** Pull `--flag value` / `--flag-file path` out of `set` argv, leaving the path positional. */
interface RepoFlags {
  path?: string
  initScript?: string
  initPrompt?: string
}

function parseRepoArgs(args: readonly string[]): RepoFlags {
  const out: RepoFlags = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const need = (): string => {
      const v = args[++i]
      if (v === undefined) usageError(`${a} requires a value`)
      return v
    }
    if (a === "--init-script") out.initScript = need()
    else if (a === "--init-script-file") out.initScript = readArgFile(need())
    else if (a === "--init-prompt") out.initPrompt = need()
    else if (a === "--init-prompt-file") out.initPrompt = readArgFile(need())
    else if (a.startsWith("-")) usageError(`unknown flag "${a}"`)
    else if (out.path === undefined) out.path = a
    else usageError(`unexpected argument "${a}"`)
  }
  return out
}

/** unset has its own flag meaning (boolean clears), so parse it separately. */
function parseUnsetArgs(args: readonly string[]): { path?: string; clearScript: boolean; clearPrompt: boolean } {
  let path: string | undefined
  let clearScript = false
  let clearPrompt = false
  for (const a of args) {
    if (a === "--init-script") clearScript = true
    else if (a === "--init-prompt") clearPrompt = true
    else if (a.startsWith("-")) usageError(`unknown flag "${a}"`)
    else if (path === undefined) path = a
    else usageError(`unexpected argument "${a}"`)
  }
  // No field flag → clear both.
  if (!clearScript && !clearPrompt) {
    clearScript = true
    clearPrompt = true
  }
  return { path, clearScript, clearPrompt }
}

export async function runRepoSubcommand(args: readonly string[]): Promise<void> {
  const [verb, ...rest] = args
  if (verb === undefined || verb === "--help" || verb === "-h" || verb === "help") {
    process.stdout.write(`${REPO_USAGE}\n`)
    return
  }

  // Accept-set from `subcommands.ts` so `kobe completions` and this dispatch
  // cannot drift apart — see the comment there.
  if (!SUBCOMMAND_VERBS.repo.includes(verb)) usageError(`unknown verb "${verb}"`)

  const { getRepoInitOverride, setRepoInitOverride, resolveRepoRoot } = await import("../state/repos.ts")

  if (verb === "show") {
    const [pathArg] = rest.filter((a) => !a.startsWith("-"))
    const repo = resolveRepoRoot(resolve(process.cwd(), expandTilde(pathArg ?? ".")))
    const override = getRepoInitOverride(repo)
    const { describeRepoInitSources } = await import("../state/repo-init.ts")
    const sources = describeRepoInitSources(repo)
    console.log(`repo: ${repo}`)
    for (const group of [sources.script, sources.prompt]) {
      group.forEach((source, index) => {
        console.log(`  ${`${source.rel}:`.padEnd(22)}${describeSource(group, index)}`)
      })
    }
    console.log(`  override initScript:  ${override.initScript ? quotePreview(override.initScript) : "(unset)"}`)
    console.log(`  override initPrompt:  ${override.initPrompt ? quotePreview(override.initPrompt) : "(unset)"}`)
    return
  }

  if (verb === "set") {
    const flags = parseRepoArgs(rest)
    if (flags.initScript === undefined && flags.initPrompt === undefined) {
      usageError("set needs at least one of --init-script(-file) / --init-prompt(-file)")
    }
    const repo = resolveRepoRoot(resolve(process.cwd(), expandTilde(flags.path ?? ".")))
    const next = setRepoInitOverride(repo, {
      ...(flags.initScript !== undefined ? { initScript: flags.initScript } : {}),
      ...(flags.initPrompt !== undefined ? { initPrompt: flags.initPrompt } : {}),
    })
    console.log(`updated override for ${repo}`)
    console.log(`  initScript: ${next.initScript ? quotePreview(next.initScript) : "(unset)"}`)
    console.log(`  initPrompt: ${next.initPrompt ? quotePreview(next.initPrompt) : "(unset)"}`)
    return
  }

  if (verb === "unset") {
    const { path, clearScript, clearPrompt } = parseUnsetArgs(rest)
    const repo = resolveRepoRoot(resolve(process.cwd(), expandTilde(path ?? ".")))
    const next = setRepoInitOverride(repo, {
      ...(clearScript ? { initScript: "" } : {}),
      ...(clearPrompt ? { initPrompt: "" } : {}),
    })
    console.log(`cleared override for ${repo}`)
    console.log(`  initScript: ${next.initScript ? quotePreview(next.initScript) : "(unset)"}`)
    console.log(`  initPrompt: ${next.initPrompt ? quotePreview(next.initPrompt) : "(unset)"}`)
    return
  }

  // Unreachable via the gate above; kept so a verb added to SUBCOMMAND_VERBS
  // without a branch here fails loud instead of silently doing nothing.
  usageError(`unknown verb "${verb}"`)
}

/**
 * How `repo show` labels one repo-init candidate. "wins" comes from
 * `describeRepoInitSources`, which applies the SAME rules as the runtime — a
 * file present but empty is reported as ignored rather than winning, which is
 * exactly the confusion this command is run to resolve.
 */
function describeSource(group: readonly { present: boolean; effective: boolean }[], index: number): string {
  const source = group[index]
  if (!source) return "absent"
  if (source.effective) return "present (wins)"
  if (!source.present) return "absent"
  // Present but not used: either a higher-precedence candidate took it, or it
  // holds nothing but whitespace and the runtime skipped it.
  const shadowed = group.slice(0, index).some((earlier) => earlier.effective)
  return shadowed ? "present (shadowed)" : "present but empty (ignored)"
}

/** Single-line preview of a possibly multi-line value for `repo show`. */
function quotePreview(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim()
  return oneLine.length > 60 ? `"${oneLine.slice(0, 57)}…"` : `"${oneLine}"`
}
