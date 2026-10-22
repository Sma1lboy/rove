/**
 * First-party mods: features whose code ships with Rove but that stay out of
 * every surface until installed (`rove plugin install kanban`, or Settings →
 * Plugins in the TUI or web). `<home>/.rove/builtin-mods.json` lists the
 * installed ids; absent means none. Uninstalling only drops the id, so the
 * feature's own data on disk is picked up again by a later install.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { OWNER_ONLY_FILE_MODE } from "../daemon/owner-only.ts"
import { builtinModsPath } from "./plugin-paths.ts"

export const BUILTIN_MOD_IDS = ["kanban", "issues"] as const
export type BuiltinModId = (typeof BUILTIN_MOD_IDS)[number]

export interface BuiltinModInfo {
  readonly id: BuiltinModId
  readonly name: string
  readonly description: string
}

export const BUILTIN_MODS: readonly BuiltinModInfo[] = [
  {
    id: "kanban",
    name: "Kanban",
    description: "Stories as a Backlog / In progress / Parked / Done board, with the `rove api issue-*` store",
  },
  {
    id: "issues",
    name: "Issues",
    description: "Open GitHub issues for the selected project via `gh`, with `rove api workitem-*`",
  },
]

export function isBuiltinModId(value: string): value is BuiltinModId {
  return (BUILTIN_MOD_IDS as readonly string[]).includes(value)
}

/** Installed ids in catalogue order; an unreadable or corrupt file reads as none installed. */
export function installedBuiltinMods(homeDir?: string): readonly BuiltinModId[] {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(builtinModsPath(homeDir), "utf8"))
  } catch {
    return []
  }
  const listed = raw && typeof raw === "object" ? (raw as { installed?: unknown }).installed : undefined
  if (!Array.isArray(listed)) return []
  return BUILTIN_MOD_IDS.filter((id) => listed.includes(id))
}

export function isBuiltinModInstalled(id: BuiltinModId, homeDir?: string): boolean {
  return installedBuiltinMods(homeDir).includes(id)
}

export function setBuiltinModInstalled(id: BuiltinModId, installed: boolean, homeDir?: string): void {
  const current = new Set(installedBuiltinMods(homeDir))
  if (installed) current.add(id)
  else current.delete(id)
  const path = builtinModsPath(homeDir)
  mkdirSync(dirname(path), { recursive: true })
  const next = BUILTIN_MOD_IDS.filter((mod) => current.has(mod))
  writeFileSync(path, `${JSON.stringify({ installed: next }, null, 2)}\n`, { mode: OWNER_ONLY_FILE_MODE })
}

/** The refusal every gated surface returns, so the fix reads the same from the CLI, the TUI and the web. */
export function builtinModMissingMessage(id: BuiltinModId): string {
  const mod = BUILTIN_MODS.find((m) => m.id === id)
  return `the ${mod?.name ?? id} mod is not installed; install it with \`rove plugin install ${id}\` or from Settings → Plugins`
}
