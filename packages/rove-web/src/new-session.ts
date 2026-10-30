/** Pure rules of the New session composer: what the model chip offers and what Start sends. Names come from the engine registry. */

import { deriveTitleFromPrompt } from "@sma1lboy/rove/src/orchestrator/title.ts"
import { splitRepoRow } from "./new-task-paths.ts"

/** The slice of an `engines.list` row the composer reads. */
export interface ComposerEngine {
  readonly id: string
  readonly models?: ReadonlyArray<{ readonly id: string; readonly label?: string }> | null
  readonly effortLevels?: readonly string[]
  readonly acceptsModel?: boolean
  /** Binary present and signed in; absent = unknown, which counts as usable. */
  readonly ready?: boolean
  /** false = switched off in Settings → Engines; absent (an older bridge) = on. */
  readonly enabled?: boolean
}

/**
 * The engines a picker may OFFER for new work: those switched off in Settings → Engines are left out, as the TUI's
 * pickers do. `keep` is an engine that stays listed anyway (the one an existing task is on, so it can be re-picked).
 */
export function offeredEngines<E extends { readonly id: string; readonly enabled?: boolean }>(
  engines: readonly E[],
  keep?: string,
): E[] {
  return engines.filter((e) => e.enabled !== false || e.id === keep)
}

/** The engine a picker opens on: the first ready one, else the first; "" when nothing is offered. */
export function defaultEngineId(offered: readonly { readonly id: string; readonly ready?: boolean }[]): string {
  return (offered.find((e) => e.ready !== false) ?? offered[0])?.id ?? ""
}

export interface Choice {
  readonly id: string
  readonly label: string
}

/** Engine default first (`id` ""), then the registry's models; none when the engine takes no model flag. */
export function modelChoices(engine: ComposerEngine | undefined, defaultLabel: string): readonly Choice[] {
  if (!engine || engine.acceptsModel === false) return []
  return [{ id: "", label: defaultLabel }, ...(engine.models ?? []).map((m) => ({ id: m.id, label: m.label ?? m.id }))]
}

/** Engine default first, then the levels the engine declares; none when it takes no effort. */
export function effortChoices(engine: ComposerEngine | undefined, defaultLabel: string): readonly Choice[] {
  const levels = engine?.effortLevels ?? []
  return levels.length === 0 ? [] : [{ id: "", label: defaultLabel }, ...levels.map((id) => ({ id, label: id }))]
}

/** `<model> <effort>`, the way claude.ai/code words its chip; no pick shows `defaultLabel` (the engine's name). */
export function modelChipLabel(models: readonly Choice[], model: string, effort: string, defaultLabel: string): string {
  const name = model ? (models.find((m) => m.id === model)?.label ?? model) : defaultLabel
  return effort ? `${name} ${effort}` : name
}

/** A task spans at most this many repos (the daemon's `MULTI_REPO_CAP`). */
export const REPO_CAP = 8

/** The primary repo's name, then `+N` for the others; hover lists them all. */
export function repoChipLabel(repos: readonly string[]): string {
  const [primary, ...rest] = repos
  if (!primary) return ""
  const name = splitRepoRow(primary).base
  return rest.length > 0 ? `${name} +${rest.length}` : name
}

/**
 * Pick or un-pick `path`: a new pick goes last (the first picked stays primary, up to {@link REPO_CAP}),
 * and removing the primary promotes the next pick. Never empties the list below zero picks.
 */
export function toggleRepo(repos: readonly string[], path: string): readonly string[] {
  if (repos.includes(path)) return repos.filter((r) => r !== path)
  return repos.length >= REPO_CAP ? repos : [...repos, path]
}

/** The menu row a digit key picks: "1" is the first of `count`; 0, non-digits and out-of-range pick nothing. */
export function digitRow(key: string, count: number): number | null {
  if (!/^[1-9]$/.test(key)) return null
  const index = Number(key) - 1
  return index < count ? index : null
}

/** One picked repo as Start sends it: its checkout root and the ref its worktree branches from ("" = the repo's current branch). */
export interface StartRepo {
  readonly repo: string
  readonly baseRef: string
}

export interface StartInput {
  /** In pick order: the first is the primary. */
  readonly repos: readonly StartRepo[]
  /** The branch name every repo's worktree gets; "" = derived. */
  readonly branch: string
  readonly engine: string
  readonly prompt: string
  /** false: create the task without running its engine. */
  readonly begin: boolean
  readonly model: string
  readonly effort: string
}

/**
 * The `task.spawn` args for Start: the session is born by this prompt, on the primary repo, with the other
 * picks as `extraRepos` in pick order. Without `begin` the engine stays off and the typed prompt names the
 * task instead of being lost.
 */
export function spawnArgs(input: StartInput): Record<string, unknown> {
  const [primary, ...extras] = input.repos
  if (!primary) throw new Error("no repo")
  const title = input.begin ? "" : deriveTitleFromPrompt(input.prompt)
  return {
    repo: primary.repo,
    ...(primary.baseRef ? { baseBranch: primary.baseRef } : {}),
    ...(extras.length > 0
      ? { extraRepos: extras.map((e) => ({ repo: e.repo, ...(e.baseRef ? { baseRef: e.baseRef } : {}) })) }
      : {}),
    // The shared name is set in the Branches menu, which a lone repo does not have, so a stale one never rides along.
    ...(extras.length > 0 && input.branch ? { branch: input.branch } : {}),
    ...(input.begin && input.prompt ? { prompt: input.prompt } : {}),
    ...(title ? { title } : {}),
    ...(input.engine ? { engine: input.engine } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
  }
}
