/**
 * Resolve a repo's per-worktree init script + first prompt.
 *
 * Two sources, resolved PER FIELD, in-repo files winning:
 *
 *   1. Version-controlled files in the worktree (legacy `.kobe/` spellings
 *      are field-by-field fallbacks):
 *        <worktree>/.rove/init.sh         → runs before the engine starts
 *        <worktree>/.rove/init-prompt.md  → pasted as the engine's first prompt
 *   2. Per-user state.json override (`rove repo set …`), keyed by git
 *      toplevel so it covers every worktree of the repo.
 *
 * The script runs in the worktree cwd, in the SAME shell that execs the
 * engine, so `export`s reach it; once per worktree (a marker under
 * `<home>/.rove/` gates re-runs — see env.ts). The prompt is delivered only
 * on fresh session create, never on re-attach.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { type ObservedLanguage, detectLanguage } from "@sma1lboy/kobe-daemon/prompts/observed-language"
import { REPO_CONFIG_DIRS, isNonEmptyRepoFile, readFirstNonEmptyRepoFile } from "../lib/repo-config-file.ts"
import { getRepoInitOverride } from "./repos.ts"

export interface ResolvedRepoInit {
  /** Shell snippet to run before the engine (or undefined for none). */
  readonly initScript?: string
  /** First prompt to deliver after the engine wakes (or undefined). */
  readonly initPrompt?: string
}

type FirstEngineMessageSource = "repo-init" | "explicit"

interface FirstEngineMessage {
  /** Text to paste into the engine composer as the first submitted message. */
  readonly text: string
  /** Why this first message exists; keeps priority rules explicit. */
  readonly source: FirstEngineMessageSource
}

export interface EngineLaunchInit {
  /** Shell snippet to weave before the engine process on fresh session create. */
  readonly initScript?: string
  /** Optional first message for ensureSession's fresh-create path to deliver. */
  readonly firstMessage?: FirstEngineMessage
}

export type PromptDeliveryIntent =
  | { readonly kind: "repo-init" }
  | { readonly kind: "explicit"; readonly prompt: string }
  /**
   * FIRST prompt of a freshly created worktree task (`add --prompt`,
   * `fan-out`, quick-fork, work-item/automation starts): `explicit` plus
   * codas about THIS worktree's state (the missing-dependencies warning).
   * Prompts into EXISTING sessions (`send`, dispatch, handoff) stay `explicit`
   * so they never re-append them. Standing worker instructions live in the
   * Rove agent skill, not here.
   */
  | { readonly kind: "new-task"; readonly prompt: string }
  | { readonly kind: "none" }

/**
 * Lockfile → the directory its install step produces. Lockfile without that
 * directory = never installed, so agents misreport install breakage as a regression.
 *
 * ponytail: a flat table, not a package-manager abstraction. Add a row when a
 * real repo needs one.
 */
const LOCKFILE_DEPENDENCY_DIRS = [
  ["bun.lock", "node_modules"],
  ["bun.lockb", "node_modules"],
  ["package-lock.json", "node_modules"],
  ["yarn.lock", "node_modules"],
  ["pnpm-lock.yaml", "node_modules"],
  ["Cargo.lock", "target"],
  ["poetry.lock", ".venv"],
  ["uv.lock", ".venv"],
] as const

/**
 * Warn a fresh worktree's first agent that dependencies were never installed.
 * Advice only — installing is `.rove/init.sh`'s job, so a repo that ships one
 * (or a per-user override) gets nothing from here; see `firstMessageFor`.
 */
export function missingDependenciesCoda(worktreePath: string, language?: ObservedLanguage): string | undefined {
  const missing = new Set<string>()
  for (const [lockfile, dependencyDir] of LOCKFILE_DEPENDENCY_DIRS) {
    if (!existsSync(join(worktreePath, lockfile))) continue
    if (existsSync(join(worktreePath, dependencyDir))) continue
    missing.add(dependencyDir)
  }
  if (missing.size === 0) return undefined
  const dirs = [...missing].join(", ")
  // Language comes from the caller's first prompt, so no stored state is needed.
  if (language === "zh") {
    return `补充：这个 worktree 没有装依赖（仓库里有 lockfile，但 ${dirs} 不存在）。在相信任何构建 / 测试结果之前，先跑一遍本仓库的安装步骤——这里的失败多半是因为没装依赖，而不是代码回归。如果这个仓库每次都需要装，可以考虑加一个 \`.rove/init.sh\`。`
  }
  return `PS: this worktree has no installed dependencies (${dirs} missing beside a committed lockfile). Run the repo's install step before trusting build/test results — a failure here is most likely the missing install, not a regression. If this repo always needs one, consider adding \`.rove/init.sh\`.`
}

const INIT_SCRIPT_FILENAME = "init.sh"
const INIT_PROMPT_FILENAME = "init-prompt.md"

function repoFileScript(worktreePath: string): string | undefined {
  // `sh <relative path>` (cwd is the worktree) works without chmod +x. `join`
  // is only for probing: the command stays POSIX because Git Bash treats `\`
  // as an escape. Picked on EXISTENCE: an empty `init.sh` is a deliberate
  // "run nothing" that must still beat the state.json override.
  for (const dir of REPO_CONFIG_DIRS) {
    if (existsSync(join(worktreePath, dir, INIT_SCRIPT_FILENAME))) return `sh ${dir}/${INIT_SCRIPT_FILENAME}`
  }
  return undefined
}

function repoFilePrompt(worktreePath: string): string | undefined {
  return readFirstNonEmptyRepoFile(worktreePath, INIT_PROMPT_FILENAME)
}

/** One candidate repo-init file, as `rove repo show` reports it. */
export interface RepoInitSource {
  /** Repo-relative path, e.g. `.rove/init.sh`. */
  readonly rel: string
  /** The file exists on disk. */
  readonly present: boolean
  /** This candidate is the one {@link resolveRepoInit} actually uses. */
  readonly effective: boolean
}

/**
 * Which repo-init candidates exist and which one WINS, by the same rules
 * {@link resolveRepoInit} applies — a bare `existsSync` would report an EMPTY
 * `init-prompt.md` as winning while the runtime falls through past it.
 */
export function describeRepoInitSources(repoRoot: string): {
  script: readonly RepoInitSource[]
  prompt: readonly RepoInitSource[]
} {
  const describe = (filename: string, counts: (absolute: string) => boolean): RepoInitSource[] => {
    let taken = false
    return REPO_CONFIG_DIRS.map((dir) => {
      const absolute = join(repoRoot, dir, filename)
      const effective = !taken && counts(absolute)
      if (effective) taken = true
      return { rel: `${dir}/${filename}`, present: existsSync(absolute), effective }
    })
  }
  return {
    script: describe(INIT_SCRIPT_FILENAME, existsSync),
    prompt: describe(INIT_PROMPT_FILENAME, isNonEmptyRepoFile),
  }
}

/**
 * Resolve the effective init script + first prompt for a worktree. Repo
 * files win per field; the state.json override fills the gaps.
 */
export function resolveRepoInit(repoRoot: string, worktreePath: string): ResolvedRepoInit {
  const override = repoRoot ? getRepoInitOverride(repoRoot) : {}
  const initScript = repoFileScript(worktreePath) ?? override.initScript
  const initPrompt = repoFilePrompt(worktreePath) ?? override.initPrompt
  return {
    initScript: initScript && initScript.trim().length > 0 ? initScript : undefined,
    initPrompt: initPrompt && initPrompt.trim().length > 0 ? initPrompt : undefined,
  }
}

function firstMessageFor(
  intent: PromptDeliveryIntent,
  init: ResolvedRepoInit,
  worktreePath: string,
): FirstEngineMessage | undefined {
  if (intent.kind === "none") return undefined
  if (intent.kind === "explicit") return { source: "explicit", text: intent.prompt }
  if (intent.kind === "new-task") {
    // With an init script the install already ran (or was declined), so the warning is noise.
    const deps = init.initScript
      ? undefined
      : missingDependenciesCoda(worktreePath, detectLanguage(intent.prompt) ?? undefined)
    return {
      source: "explicit",
      text: [intent.prompt, deps].filter(Boolean).join("\n\n"),
    }
  }
  const text = init.initPrompt?.trim()
  return text ? { source: "repo-init", text } : undefined
}

/**
 * Resolve the complete launch-time prompt contract for a worktree. Callers
 * choose the intent; this module owns the source priority and first-message
 * shape so engine launch paths don't hand-roll initPrompt suppression.
 */
export function resolveEngineLaunchInit(
  repoRoot: string,
  worktreePath: string,
  intent: PromptDeliveryIntent = { kind: "repo-init" },
): EngineLaunchInit {
  const init = resolveRepoInit(repoRoot, worktreePath)
  return {
    initScript: init.initScript,
    firstMessage: firstMessageFor(intent, init, worktreePath),
  }
}
