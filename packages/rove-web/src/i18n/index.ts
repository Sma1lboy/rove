/**
 * `t("ns.key", params)` over the en/zh catalogs. Call it inside render, never
 * into a module-level constant, or the language freezes. The locale is the one
 * picked in Settings (per browser), else the browser's.
 */

import { createStore, useStore } from "../store.ts"
import { en } from "./en.ts"
import { zh } from "./zh.ts"

export type Locale = "en" | "zh"

const CATALOGS: Record<Locale, typeof en> = { en, zh }

export const LOCALE_KEY = "rove.locale"
const saved = localStorage.getItem(LOCALE_KEY)
export const locale = createStore<Locale>(
  saved === "en" || saved === "zh" ? saved : navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en",
)

function lookup(tree: unknown, key: string): string | undefined {
  let node = tree
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) return undefined
    node = Reflect.get(node, part)
  }
  return typeof node === "string" ? node : undefined
}

export function t(key: string, params?: Record<string, string | number>): string {
  const text = lookup(CATALOGS[locale.get()], key) ?? lookup(en, key) ?? key
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) : text
}

/** Re-render on language change. */
export function useLocale(): Locale {
  return useStore(locale)
}
