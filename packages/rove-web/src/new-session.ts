/** Pure rules of the New session composer: what the model chip offers and what Start sends. Names come from the engine registry. */

import { splitRepoRow } from "./new-task-paths.ts"

/** The slice of an `engines.list` row the composer reads. */
export interface ComposerEngine {
  readonly id: string
  readonly models?: ReadonlyArray<{ readonly id: string; readonly label?: string }> | null
  readonly effortLevels?: readonly string[]
  readonly acceptsModel?: boolean
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

/** The primary repo's name, then `+N` for the others (multi-repo is a later milestone; the chip is ready for it). */
export function repoChipLabel(repos: readonly string[]): string {
  const [primary, ...rest] = repos
  if (!primary) return ""
  const name = splitRepoRow(primary).base
  return rest.length > 0 ? `${name} +${rest.length}` : name
}

/** The menu row a digit key picks: "1" is the first of `count`; 0, non-digits and out-of-range pick nothing. */
export function digitRow(key: string, count: number): number | null {
  if (!/^[1-9]$/.test(key)) return null
  const index = Number(key) - 1
  return index < count ? index : null
}

export interface StartInput {
  readonly repos: readonly string[]
  readonly engine: string
  readonly baseBranch: string
  readonly prompt: string
  readonly model: string
  readonly effort: string
}

/** The `task.spawn` args for Start: the session is born by this prompt, on the primary repo; no prompt creates the task without starting its engine. */
export function spawnArgs(input: StartInput): Record<string, string> {
  const [repo] = input.repos
  if (!repo) throw new Error("no repo")
  return {
    repo,
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.engine ? { engine: input.engine } : {}),
    ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
  }
}
