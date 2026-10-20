/**
 * The TUI's own words for the keymap: action labels (`keys.desc`), group names
 * (`keys.category`) and the help/palette/hint strings, read from its catalogs so
 * the two clients cannot drift. Locale is the page's (Settings), not the TUI's.
 */

import { en as helpEn, zh as helpZh } from "@sma1lboy/rove/src/tui/i18n/messages/help.ts"
import { en as hintsEn, zh as hintsZh } from "@sma1lboy/rove/src/tui/i18n/messages/hints.ts"
import { en as keysEn, zh as keysZh } from "@sma1lboy/rove/src/tui/i18n/messages/keys.ts"
import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { en as terminalEn, zh as terminalZh } from "@sma1lboy/rove/src/tui/i18n/messages/terminal.ts"
import { en as workspaceEn, zh as workspaceZh } from "@sma1lboy/rove/src/tui/i18n/messages/workspace.ts"
import { locale } from "./i18n/index.ts"

function lookup(tree: unknown, key: string): string | undefined {
  let node = tree
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) return undefined
    node = Reflect.get(node, part)
  }
  return typeof node === "string" ? node : undefined
}

function pick<T>(en: T, zh: T): T {
  return locale.get() === "zh" ? zh : en
}

function fill(text: string, params?: Record<string, string | number>): string {
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) : text
}

/** `help.*` (palette, F1, command-layer headers). */
export const helpText = (key: string, params?: Record<string, string | number>): string =>
  fill(lookup(pick(helpEn, helpZh), key) ?? lookup(helpEn, key) ?? key, params)

/** `hints.*` (footer key hints). */
export const hintText = (key: string, params?: Record<string, string | number>): string =>
  fill(lookup(pick(hintsEn, hintsZh), key) ?? lookup(hintsEn, key) ?? key, params)

/** `terminal.*` (scrollback overlay, search row, reset confirm). */
export const terminalText = (key: string, params?: Record<string, string | number>): string =>
  fill(lookup(pick(terminalEn, terminalZh), key) ?? lookup(terminalEn, key) ?? key, params)

/** `keys.desc[id]`: the action's name in the palette, F1 and the footer. */
export function actionDesc(id: string): string {
  const desc: Record<string, string> = pick(keysEn, keysZh).desc
  return desc[id] ?? keysEn.desc[id as keyof typeof keysEn.desc] ?? id
}

/** The HUD's cheat-sheet caption: `actionDesc` clipped at a dash-led elaboration. */
export function actionLabel(id: string): string {
  const label = actionDesc(id)
  const dash = label.search(/\s—\s|——/)
  return dash > 0 ? label.slice(0, dash) : label
}

/** `keys.category[name]`: a group header. */
export function categoryName(name: string): string {
  const category: Record<string, string> = pick(keysEn, keysZh).category
  return category[name] ?? name
}

/** `workspace.*` (the narrow layout's back row). */
export const workspaceText = (key: string, params?: Record<string, string | number>): string =>
  fill(lookup(pick(workspaceEn, workspaceZh), key) ?? lookup(workspaceEn, key) ?? key, params)

/** `tasks.*` (the Recent row). */
export const tasksText = (key: string, params?: Record<string, string | number>): string =>
  fill(lookup(pick(tasksEn, tasksZh), key) ?? lookup(tasksEn, key) ?? key, params)
