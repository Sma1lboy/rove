/**
 * Reactive translation runtime: one framework-free cell holds the process
 * language; `t()` reads it and React subscribes via `useSyncExternalStore`
 * (`tui-react/i18n`). The booter seeds it from `state.json`
 * (`readPersistedUiPrefs().locale`) and Settings calls `setLocaleLang` +
 * `kv.set("locale", …)`; this module owns only the in-memory value.
 *
 * Call `t()` inside the render/getter; never keep `t("…")`'s RESULT in a
 * module-level constant, which freezes the language.
 */

import { type ReadableState, createStateCell } from "../../lib/external-store"
import { CATALOGS, DEFAULT_LOCALE, LOCALES, type LocaleId } from "./catalog"
import { interpolate, lookup, lookupKeys } from "./lookup"

export type { LocaleId } from "./catalog"

const langState = createStateCell<LocaleId>(DEFAULT_LOCALE)

/** Switch the active UI language for THIS process (reactive). No-op on an unknown id. */
export function setLocaleLang(lang: LocaleId): void {
  if (CATALOGS[lang]) langState.set(lang)
}

export function currentLang(): LocaleId {
  return langState.get()
}

/** BCP-47 tag for `Intl` / `toLocale*`, so dates follow the UI setting, not the machine. */
export function intlLocale(): string {
  return LOCALES.find((locale) => locale.id === langState.get())?.intl ?? "en-US"
}

/** Read-only process locale state for UI adapters. */
export function localeState(): ReadableState<LocaleId> {
  return langState
}

/** Falls back to English, then the raw key (missing strings are loud, not blank). */
export function t(key: string, params?: Record<string, string | number>): string {
  const lang = langState.get()
  const resolved = lookup(CATALOGS[lang], key) ?? lookup(CATALOGS.en, key) ?? key
  return interpolate(resolved, params)
}

/**
 * Catalog lookup for `keys.category.*` / `keys.desc.*`, whose keys are binding
 * ids with dots (`chat.tab.new`) that the dotted `t()` path would mis-split;
 * indexes the leaf record by the EXACT key. English, then raw-id fallback.
 */
export function tKeys(group: "category" | "desc", key: string): string {
  const lang = langState.get()
  return lookupKeys(CATALOGS[lang], group, key) ?? lookupKeys(CATALOGS.en, group, key) ?? key
}
