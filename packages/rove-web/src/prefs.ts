/**
 * The TUI's Settings knobs as the page sees them: `prefs.get` reads state.json through the TUI's
 * own normalizers, `prefs.set` writes one key back, so changing a knob here changes the TUI
 * (live for theme, mode, accent and language; at its next start for the rest). The last reply is
 * kept in localStorage only to paint the first frame in the right colours.
 */

import type { BridgeClient } from "./bridge.ts"
import { locale } from "./i18n/index.ts"
import { createStore, useStore } from "./store.ts"
import { toast } from "./ui.ts"

export interface Prefs {
  readonly locale: "en" | "zh"
  readonly theme: string
  readonly themeMode: "dark" | "light" | "auto"
  readonly transparent: boolean
  readonly focusAccent: "primary" | "success" | "info"
  readonly splitStyle: string
  readonly railFold: "glyphs" | "initials" | "hairline"
  readonly tabRowHeight: 1 | 2
  readonly workingBorder: "flow" | "still"
  readonly taskColors: "on" | "off"
  readonly glyphSet: "braille" | "starburst" | "ascii"
  readonly colorblind: "on" | "off"
  readonly runningTitle: "shimmer" | "still"
  readonly toast: boolean
  readonly sound: boolean
  readonly soundVolume: number
  readonly crossTask: boolean
  readonly keyHints: boolean
  readonly zen: boolean
  readonly editorKind: string
  readonly worktreeBase: "default" | "nextToProject" | "custom"
  readonly scrollbackRows: number
  readonly tabStrip: "always" | "multipleOnly" | "never"
  readonly prefixTap: "local" | "guide"
  readonly remoteProjects: boolean
  readonly autoStatus: boolean
  readonly dispatcher: boolean
}

export type PrefKey = keyof Prefs

/** One theme resolved to `#rrggbb` per slot, for each half (`prefs.get` → `themes`). */
export interface ThemeEntry {
  readonly name: string
  readonly bundled: boolean
  readonly dark: Readonly<Record<string, string>>
  readonly light: Readonly<Record<string, string>>
}

/** The TUI's state-mark vocabulary for one preset (`tui/lib/glyphs.ts`). */
export interface GlyphSet {
  readonly spinner: readonly string[]
  readonly idle: string
  readonly unseen: string
  readonly needsInput: string
  readonly attention: string
  readonly running: string
  readonly done: string
  readonly rateLimited: string
  readonly dead: string
  readonly routineFailed: string
  readonly subagent: string
  readonly conflict: string
  readonly checksFailing: string
  readonly checksPassing: string
}

export type Options = Readonly<Record<string, readonly (string | number | boolean)[] | { min: number; max: number }>>

export interface PrefsState {
  /** False until a reply (or a cached one) arrives; nothing is overridden before. */
  readonly loaded: boolean
  readonly prefs: Prefs
  readonly options: Options
  readonly info: { readonly editorCustomSet: boolean; readonly worktreeCustomPath: string }
  readonly themes: readonly ThemeEntry[]
  readonly glyphSets: Readonly<Record<string, GlyphSet>>
}

interface PrefsReply {
  readonly prefs: Prefs
  readonly options: Options
  readonly info: PrefsState["info"]
  readonly themes: readonly ThemeEntry[]
  readonly glyphSets: PrefsState["glyphSets"]
}

const CACHE_KEY = "rove.prefs"

/** What the TUI shows with an empty state.json; replaced by the first reply. */
const DEFAULTS: Prefs = {
  locale: "en",
  theme: "claude",
  themeMode: "dark",
  transparent: true,
  focusAccent: "primary",
  splitStyle: "line",
  railFold: "glyphs",
  tabRowHeight: 1,
  workingBorder: "flow",
  taskColors: "on",
  glyphSet: "braille",
  colorblind: "off",
  runningTitle: "shimmer",
  toast: true,
  sound: true,
  soundVolume: 0.4,
  crossTask: true,
  keyHints: true,
  zen: true,
  editorKind: "auto",
  worktreeBase: "default",
  scrollbackRows: 1000,
  tabStrip: "never",
  prefixTap: "local",
  remoteProjects: false,
  autoStatus: false,
  dispatcher: false,
}

function cached(): PrefsState {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null")
    if (raw && typeof raw === "object" && "prefs" in raw && "themes" in raw) {
      return { ...(raw as PrefsState), loaded: true }
    }
  } catch {
    // A corrupt cache is just no cache.
  }
  return {
    loaded: false,
    prefs: DEFAULTS,
    options: {},
    info: { editorCustomSet: false, worktreeCustomPath: "" },
    themes: [],
    glyphSets: {},
  }
}

export const prefsStore = createStore<PrefsState>(cached())

/** The language comes from state.json: the same setting the TUI shows. */
function syncLocale(prefs: Prefs): void {
  if (prefs.locale === "en" || prefs.locale === "zh") locale.set(prefs.locale)
}
syncLocale(prefsStore.get().prefs)

function accept(reply: PrefsReply): void {
  const next: PrefsState = {
    loaded: true,
    prefs: reply.prefs,
    options: reply.options,
    info: reply.info,
    themes: reply.themes,
    glyphSets: reply.glyphSets,
  }
  prefsStore.set(next)
  syncLocale(next.prefs)
  localStorage.setItem(CACHE_KEY, JSON.stringify(next))
}

export async function loadPrefs(client: BridgeClient): Promise<void> {
  accept(await client.request<PrefsReply>("prefs.get"))
}

/** Writes one key. The page shows the new value at once and takes the bridge's read-back (or reverts) when it answers. */
export async function setPref<K extends PrefKey>(client: BridgeClient, key: K, value: Prefs[K]): Promise<void> {
  const before = prefsStore.get()
  prefsStore.set({ ...before, prefs: { ...before.prefs, [key]: value } })
  syncLocale(prefsStore.get().prefs)
  try {
    const reply = await client.request<{ prefs: Prefs }>("prefs.set", { key, value })
    const now = prefsStore.get()
    accept({ ...now, prefs: reply.prefs })
  } catch (err) {
    prefsStore.set(before)
    syncLocale(before.prefs)
    toast(err instanceof Error ? err.message : String(err), "error")
  }
}

export function usePrefs(): PrefsState {
  return useStore(prefsStore)
}

/** The choices the bridge offers for an enum key. */
export function choicesOf(state: PrefsState, key: PrefKey): readonly (string | number | boolean)[] {
  const options = state.options[key]
  return Array.isArray(options) ? options : []
}

/** The next value after `current`, wrapping: the TUI's cycle rows. */
export function nextChoice<T extends string | number>(choices: readonly T[], current: T): T {
  return choices[(choices.indexOf(current) + 1) % choices.length] ?? current
}
