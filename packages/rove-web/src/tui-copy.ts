/**
 * Copy the TUI already ships, read from its own catalogs so a flow here says what the
 * same flow there says (confirm bodies, toasts, field labels). Pure data modules; the
 * language is the page's (`locale`), not the TUI's.
 */

import { en as filesEn, zh as filesZh } from "@sma1lboy/rove/src/tui/i18n/messages/files.ts"
import { en as newTaskEn, zh as newTaskZh } from "@sma1lboy/rove/src/tui/i18n/messages/newTask.ts"
import { en as quickEn, zh as quickZh } from "@sma1lboy/rove/src/tui/i18n/messages/quickTask.ts"
import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { en as termEn, zh as termZh } from "@sma1lboy/rove/src/tui/i18n/messages/terminal.ts"
import { en as updateEn, zh as updateZh } from "@sma1lboy/rove/src/tui/i18n/messages/update.ts"
import { en as wtEn, zh as wtZh } from "@sma1lboy/rove/src/tui/i18n/messages/worktrees.ts"
import { locale } from "./i18n/index.ts"

const CATALOGS = {
  files: { en: filesEn, zh: filesZh },
  newTask: { en: newTaskEn, zh: newTaskZh },
  quickTask: { en: quickEn, zh: quickZh },
  tasks: { en: tasksEn, zh: tasksZh },
  terminal: { en: termEn, zh: termZh },
  update: { en: updateEn, zh: updateZh },
  worktrees: { en: wtEn, zh: wtZh },
} as const

export type CopyNamespace = keyof typeof CATALOGS

function lookup(tree: unknown, key: string): string | undefined {
  let node = tree
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) return undefined
    node = Reflect.get(node, part)
  }
  return typeof node === "string" ? node : undefined
}

/** `tc("tasks", "sync.done", { base })`: the TUI's `t()` for one catalog. Call inside render or a handler. */
export function tc(ns: CopyNamespace, key: string, params?: Record<string, string | number>): string {
  const catalog = CATALOGS[ns]
  const text = lookup(catalog[locale.get()], key) ?? lookup(catalog.en, key) ?? key
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) : text
}
