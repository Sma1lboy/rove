/**
 * `t("ns.key", params)` over the en/zh catalogs. Call it inside render, never
 * into a module-level constant, or the language freezes. The locale is the TUI's
 * own `locale` setting (state.json, set in Settings); `prefs.ts` keeps it in step.
 * Until the first reply it is the last one seen, else the browser's.
 */

import { createStore, useStore } from "../store.ts"
import { en } from "./en.ts"
import { zh } from "./zh.ts"

export type Locale = "en" | "zh"

const CATALOGS: Record<Locale, typeof en> = { en, zh }

function lastKnownLocale(): Locale {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem("rove.prefs") ?? "null")
    if (raw && typeof raw === "object" && "prefs" in raw) {
      const prefs = raw.prefs
      if (prefs && typeof prefs === "object" && "locale" in prefs && (prefs.locale === "en" || prefs.locale === "zh")) {
        return prefs.locale
      }
    }
  } catch {
    // No cache: the browser's language.
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"
}

export const locale = createStore<Locale>(lastKnownLocale())

function lookup(tree: unknown, key: string): string | undefined {
  let node = tree
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) return undefined
    node = Reflect.get(node, part)
  }
  return typeof node === "string" ? node : undefined
}

type Params = Record<string, string | number>

function fill(text: string, params?: Params): string {
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) : text
}

export function t(key: string, params?: Params): string {
  return fill(lookup(CATALOGS[locale.get()], key) ?? lookup(en, key) ?? key, params)
}

/** `t` over the TUI's own catalogs (English first, like the TUI), for copy the TUI already words. */
export function tFrom(catalogs: Record<Locale, unknown>, key: string, params?: Params): string {
  return fill(lookup(catalogs[locale.get()], key) ?? lookup(catalogs.en, key) ?? key, params)
}

/** Re-render on language change. */
export function useLocale(): Locale {
  return useStore(locale)
}
