/**
 * Resolve a repo's per-worktree init script + first prompt.
 *
 * Two sources, resolved PER FIELD with the in-repo files taking priority:
 *
 *   1. In-repo convention files, checked out in the worktree:
 *        <worktree>/.rove/init.sh         → runs before the engine starts
 *        <worktree>/.rove/init-prompt.md  → pasted as the engine's first prompt
 *      The legacy `.kobe/` spellings remain field-by-field fallbacks.
 *      These are version-controlled, so they're the project's authoritative
 *      setup and WIN when present.
 *   2. Per-user state.json override (`rove repo set …`) — a fallback default
 *      for a repo that doesn't ship its own convention files. Keyed by git
 *      toplevel, so it applies to every worktree of the repo.
 *
 * The init script runs in the worktree cwd, in the SAME shell that execs
 * the engine, so `export`s reach the engine. It runs once per worktree
 * (a marker under `<home>/.rove/` gates re-runs — see env.ts). The init
 * prompt is delivered only when a session is freshly created, never on
 * re-attach.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type ObservedLanguage, detectLanguage } from "@sma1lboy/kobe-daemon/prompts/observed-language"
import { kobeApiInvocation } from "../engine/interactive-command.ts"
import { getRepoInitOverride } from "./repos.ts"

export interface ResolvedRepoInit {
  /** Shell snippet to run before the engine (or undefined for none). */
  readonly initScript?: string
  /** First prompt to deliver after the engine wakes (or undefined). */
  readonly initPrompt?: string
}

export type FirstEngineMessageSource = "repo-init" | "explicit"

export interface FirstEngineMessage {
  /** Text to paste into the engine composer as the first submitted message. */
  readonly text: string
  /** Why this first message exists; used to keep priority rules explicit. */
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
   * The FIRST prompt of a freshly created worktree task (`add --prompt`,
   * `fan-out`, quick-fork, work-item/automation starts). Delivered like
   * `explicit`, plus the codas that describe THIS worktree's state — today
   * the missing-dependencies warning. Prompts into EXISTING sessions (`send`,
   * `send --tab new`, dispatch, cross-engine handoff) stay `explicit` so they
   * never re-append them.
   *
   * Standing instructions for a worker (name your branch, report your outcome
   * home) are NOT here: they live in the Rove agent skill, which the agent
   * reads once instead of being told again in every prompt.
   */
  | { readonly kind: "new-task"; readonly prompt: string }
  | { readonly kind: "none" }

/**
 * Lockfile → the directory its install step produces. A committed lockfile
 * with no install output means the worktree was never installed, so builds,
 * type-checks and tests there fail for reasons unrelated to the task — the
 * failure mode behind issue #35 (agents reporting install breakage as a
 * product regression).
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
  // The language comes from the user's OWN first prompt, one line above the
  // call site — no stored state needed here, unlike the async injection
  // points that fire with no user message in hand.
  if (language === "zh") {
    return `补充：这个 worktree 没有装依赖（仓库里有 lockfile，但 ${dirs} 不存在）。在相信任何构建 / 测试结果之前，先跑一遍本仓库的安装步骤——这里的失败多半是因为没装依赖，而不是代码回归。如果这个仓库每次都需要装，可以考虑加一个 \`.rove/init.sh\`。`
  }
  return `PS: this worktree has no installed dependencies (${dirs} missing beside a committed lockfile). Run the repo's install step before trusting build/test results — a failure here is most likely the missing install, not a regression. If this repo always needs one, consider adding \`.rove/init.sh\`.`
}

const INIT_SCRIPT_RELS = [join(".rove", "init.sh"), join(".kobe", "init.sh")] as const
const INIT_PROMPT_RELS = [join(".rove", "init-prompt.md"), join(".kobe", "init-prompt.md")] as const

function repoFileScript(worktreePath: string): string | undefined {
  // Run the committed file by relative path: cwd is the worktree, so
  // `sh .rove/init.sh` works even when the file isn't chmod +x.
  //
  // Native `join` paths are only for probing. The shell command stays a POSIX
  // literal because Git Bash treats a backslash as an escape.
  for (const [relative, command] of [
    [INIT_SCRIPT_RELS[0], "sh .rove/init.sh"],
    [INIT_SCRIPT_RELS[1], "sh .kobe/init.sh"],
  ] as const) {
    if (existsSync(join(worktreePath, relative))) return command
  }
  return undefined
}

function repoFilePrompt(worktreePath: string): string | undefined {
  for (const relative of INIT_PROMPT_RELS) {
    const p = join(worktreePath, relative)
    if (!existsSync(p)) continue
    try {
      const text = readFileSync(p, "utf8")
      if (text.trim().length > 0) return text
    } catch {
      // An unreadable file does not block the next candidate or user fallback.
    }
  }
  return undefined
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
  taskId?: string,
): FirstEngineMessage | undefined {
  if (intent.kind === "none") return undefined
  if (intent.kind === "explicit") return { source: "explicit", text: intent.prompt }
  if (intent.kind === "new-task") {
    // Only when the repo has no init script: with one, the install already ran
    // (or the repo chose not to), and the warning would be noise. Scoped to
    // new-task so `send`/handoff prompts into existing sessions never see it.
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
  taskId?: string,
): EngineLaunchInit {
  const init = resolveRepoInit(repoRoot, worktreePath)
  return {
    initScript: init.initScript,
    firstMessage: firstMessageFor(intent, init, worktreePath, taskId),
  }
}
