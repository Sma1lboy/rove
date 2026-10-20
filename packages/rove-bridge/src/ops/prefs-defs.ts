/**
 * The allowlist behind `prefs.get` / `prefs.set`: every Settings knob the TUI keeps in
 * state.json as a flag, an enum or a bounded number, with the TUI's own normalizer reading it
 * and its own constant list bounding what may be written.
 *
 * Deliberately absent, because the value would be authored by the client and then run or
 * stored by the Mac: the custom editor command (`editor.customCommand`), the custom worktree
 * base path (`worktree.basePath.custom` is only ever the path the TUI remembered), engine
 * commands, classifier endpoints and secrets.
 */

import { AUTO_STATUS_KEY } from "@sma1lboy/rove/src/state/auto-status.ts"
import { COLORBLIND_KEY, DEFAULT_COLORBLIND, normalizeColorblind } from "@sma1lboy/rove/src/state/colorblind.ts"
import { DISPATCHER_KEY } from "@sma1lboy/rove/src/state/dispatcher.ts"
import { DEFAULT_GLYPH_SET, GLYPH_SET_KEY, normalizeGlyphSet } from "@sma1lboy/rove/src/state/glyph-set.ts"
import {
  DEFAULT_RUNNING_TITLE,
  RUNNING_TITLE_KEY,
  normalizeRunningTitle,
} from "@sma1lboy/rove/src/state/running-title.ts"
import {
  DEFAULT_SCROLLBACK_ROWS,
  SCROLLBACK_ROWS_KEY,
  SCROLLBACK_ROWS_MAX,
  SCROLLBACK_ROWS_MIN,
  normalizeScrollbackRows,
} from "@sma1lboy/rove/src/state/scrollback.ts"
import { RAIL_FOLD_STYLE_KEY } from "@sma1lboy/rove/src/state/sidebar-collapsed.ts"
import {
  DEFAULT_SOUND_VOLUME,
  SOUND_VOLUME_KEY,
  SOUND_VOLUME_STEPS,
  normalizeSoundVolume,
} from "@sma1lboy/rove/src/state/sound-volume.ts"
import { SPLIT_STYLE_KEY, normalizeSplitStyle } from "@sma1lboy/rove/src/state/split-style.ts"
import type { StateSnapshot } from "@sma1lboy/rove/src/state/store.ts"
import {
  DEFAULT_TAB_ROW_HEIGHT,
  TAB_ROW_HEIGHT_KEY,
  normalizeTabRowHeight,
} from "@sma1lboy/rove/src/state/tab-row-height.ts"
import {
  TAB_STRIP_HIDE_SINGLE_KEY,
  TAB_STRIP_MODES,
  TAB_STRIP_MODE_KEY,
  resolveTabStripMode,
} from "@sma1lboy/rove/src/state/tab-strip.ts"
import { DEFAULT_TASK_COLORS, TASK_COLORS_KEY, normalizeTaskColors } from "@sma1lboy/rove/src/state/task-colors.ts"
import {
  DEFAULT_WORKING_BORDER,
  WORKING_BORDER_KEY,
  normalizeWorkingBorder,
} from "@sma1lboy/rove/src/state/working-border.ts"
import {
  PROJECT_SIBLING_BASE,
  WORKTREE_BASE_CUSTOM_KEY,
  WORKTREE_BASE_KEY,
  type WorktreeBaseKind,
  worktreeBaseKindOf,
} from "@sma1lboy/rove/src/state/worktree-base.ts"
import { ZEN_ACTIVE_KEY, ZEN_DEFAULT } from "@sma1lboy/rove/src/state/zen.ts"
import { appearanceChoices } from "@sma1lboy/rove/src/tui/component/settings-dialog/appearance.ts"
import {
  DEFAULT_THEME,
  DEFAULT_THEME_MODE,
  FOCUS_ACCENT_SLOTS,
  THEME_MODE_PREFERENCES,
} from "@sma1lboy/rove/src/tui/context/theme-core.ts"
import { DEFAULT_LOCALE, LOCALES, isLocaleId } from "@sma1lboy/rove/src/tui/i18n/catalog.ts"
import {
  DEFAULT_EDITOR_KIND,
  EDITOR_CUSTOM_KEY,
  EDITOR_KINDS,
  EDITOR_KIND_KEY,
  normalizeEditorKind,
} from "@sma1lboy/rove/src/tui/lib/editor-prefs.ts"
import { defaultTransparentBackground } from "@sma1lboy/rove/src/tui/lib/persisted-ui-prefs.ts"
import {
  DEFAULT_PREFIX_TAP_PRESENTATION,
  PREFIX_TAP_PRESENTATIONS,
  PREFIX_TAP_PRESENTATION_KEY,
  normalizePrefixTapPresentation,
} from "@sma1lboy/rove/src/tui/lib/prefix-tap-presentation.ts"
import { BridgeError } from "../protocol.ts"

export type Scalar = string | number | boolean

/** Not exported by the TUI's state module (its own picker restates them too). */
const KEY_HINTS_ENABLED_KEY = "hints.keyboard.enabled"
const PANE_HINT_USED_KEYS = ["hints.sidebar.used", "hints.files.used"] as const
const RAIL_FOLD_STYLES = appearanceChoices("railFold", []).map((c) => c.value as string)

interface Shared {
  readonly read: (state: StateSnapshot) => Scalar
  /** The state.json patch for an already-validated `value`. */
  readonly write: (value: never, state: StateSnapshot) => StateSnapshot
}
export type PrefDef =
  | (Shared & { readonly kind: "bool" })
  | (Shared & { readonly kind: "int"; readonly min: number; readonly max: number })
  | (Shared & { readonly kind: "enum"; readonly choices: (themes: readonly string[]) => readonly Scalar[] })

const bool = (key: string, fallback: boolean, extra?: (v: boolean) => StateSnapshot): PrefDef => ({
  kind: "bool",
  read: (s) => (typeof s[key] === "boolean" ? (s[key] as boolean) : fallback),
  write: ((v: boolean) => ({ [key]: v, ...extra?.(v) })) as Shared["write"],
})

const choice = (
  key: string,
  choices: readonly Scalar[],
  read: (raw: unknown) => Scalar,
  stored: (value: never) => unknown = (v) => v,
): PrefDef => ({
  kind: "enum",
  choices: () => choices,
  read: (s) => read(s[key]),
  write: ((v: never) => ({ [key]: stored(v) })) as Shared["write"],
})

const appearance = (setting: Parameters<typeof appearanceChoices>[0]) =>
  appearanceChoices(setting, []).map((c) => c.value as Scalar)

const text = (raw: unknown): string => (typeof raw === "string" ? raw.trim() : "")

function worktreeKind(state: StateSnapshot): WorktreeBaseKind {
  return worktreeBaseKindOf(text(state[WORKTREE_BASE_KEY]))
}

/** What the TUI's "custom" row shows: the remembered path, else a legacy custom base. */
export function worktreeCustomPath(state: StateSnapshot): string {
  return (
    text(state[WORKTREE_BASE_CUSTOM_KEY]) || (worktreeKind(state) === "custom" ? text(state[WORKTREE_BASE_KEY]) : "")
  )
}

const WORKTREE_KINDS: readonly WorktreeBaseKind[] = ["default", "nextToProject", "custom"]

/** Wire name → definition. The wire name is the contract; state.json keys stay the TUI's. */
export const PREF_DEFS: Readonly<Record<string, PrefDef>> = {
  locale: choice(
    "locale",
    LOCALES.map((l) => l.id),
    (raw) => (isLocaleId(raw) ? raw : DEFAULT_LOCALE),
  ),
  theme: {
    kind: "enum",
    choices: (themes) => themes,
    read: (s) => (typeof s.activeTheme === "string" && s.activeTheme ? s.activeTheme : DEFAULT_THEME),
    write: ((v: string) => ({ activeTheme: v })) as Shared["write"],
  },
  themeMode: choice("themeMode", THEME_MODE_PREFERENCES, (raw) =>
    (THEME_MODE_PREFERENCES as readonly unknown[]).includes(raw) ? (raw as string) : DEFAULT_THEME_MODE,
  ),
  transparent: bool("transparentBackground", defaultTransparentBackground()),
  focusAccent: choice("focusAccent", FOCUS_ACCENT_SLOTS, (raw) =>
    (FOCUS_ACCENT_SLOTS as readonly unknown[]).includes(raw) ? (raw as string) : "primary",
  ),
  splitStyle: choice(SPLIT_STYLE_KEY, appearance("splitStyle"), normalizeSplitStyle),
  railFold: choice(RAIL_FOLD_STYLE_KEY, RAIL_FOLD_STYLES, (raw) =>
    RAIL_FOLD_STYLES.includes(raw as string) ? (raw as string) : "glyphs",
  ),
  tabRowHeight: choice(TAB_ROW_HEIGHT_KEY, appearance("tabRowHeight"), (raw) =>
    normalizeTabRowHeight(raw ?? DEFAULT_TAB_ROW_HEIGHT),
  ),
  workingBorder: choice(WORKING_BORDER_KEY, appearance("workingBorder"), (raw) =>
    normalizeWorkingBorder(raw ?? DEFAULT_WORKING_BORDER),
  ),
  taskColors: choice(TASK_COLORS_KEY, appearance("taskColors"), (raw) =>
    normalizeTaskColors(raw ?? DEFAULT_TASK_COLORS),
  ),
  glyphSet: choice(GLYPH_SET_KEY, appearance("glyphSet"), (raw) => normalizeGlyphSet(raw ?? DEFAULT_GLYPH_SET)),
  colorblind: choice(COLORBLIND_KEY, appearance("colorblind"), (raw) => normalizeColorblind(raw ?? DEFAULT_COLORBLIND)),
  runningTitle: choice(RUNNING_TITLE_KEY, appearance("runningTitle"), (raw) =>
    normalizeRunningTitle(raw ?? DEFAULT_RUNNING_TITLE),
  ),
  toast: bool("notifications.toast.enabled", true),
  sound: bool("notifications.sound.enabled", true),
  soundVolume: choice(SOUND_VOLUME_KEY, SOUND_VOLUME_STEPS, (raw) => normalizeSoundVolume(raw ?? DEFAULT_SOUND_VOLUME)),
  crossTask: bool("notifications.crossTask.enabled", true),
  // Turning hints on re-arms the first-use pane hints, as the TUI's toggle does.
  keyHints: bool(KEY_HINTS_ENABLED_KEY, true, (on) =>
    on ? Object.fromEntries(PANE_HINT_USED_KEYS.map((k) => [k, false])) : {},
  ),
  zen: bool(ZEN_ACTIVE_KEY, ZEN_DEFAULT),
  editorKind: choice(EDITOR_KIND_KEY, EDITOR_KINDS, (raw) => normalizeEditorKind(raw ?? DEFAULT_EDITOR_KIND)),
  worktreeBase: {
    kind: "enum",
    choices: () => WORKTREE_KINDS,
    read: (s) => worktreeKind(s),
    write: ((kind: WorktreeBaseKind, s: StateSnapshot) => {
      const current = text(s[WORKTREE_BASE_KEY])
      // Leaving a custom base keeps it, so the cycle can come back to it.
      const remember = worktreeKind(s) === "custom" && kind !== "custom" ? { [WORKTREE_BASE_CUSTOM_KEY]: current } : {}
      if (kind === "default") return { ...remember, [WORKTREE_BASE_KEY]: "" }
      if (kind === "nextToProject") return { ...remember, [WORKTREE_BASE_KEY]: PROJECT_SIBLING_BASE }
      const custom = worktreeCustomPath(s)
      if (!custom) throw new BridgeError("BAD_ARGS", "no custom worktree base is remembered; set one in the TUI")
      return { [WORKTREE_BASE_KEY]: custom }
    }) as Shared["write"],
  },
  scrollbackRows: {
    kind: "int",
    min: SCROLLBACK_ROWS_MIN,
    max: SCROLLBACK_ROWS_MAX,
    read: (s) => normalizeScrollbackRows(s[SCROLLBACK_ROWS_KEY] ?? DEFAULT_SCROLLBACK_ROWS),
    write: ((v: number) => ({ [SCROLLBACK_ROWS_KEY]: normalizeScrollbackRows(v) })) as Shared["write"],
  },
  tabStrip: {
    kind: "enum",
    choices: () => TAB_STRIP_MODES,
    read: (s) => resolveTabStripMode(s[TAB_STRIP_MODE_KEY], s[TAB_STRIP_HIDE_SINGLE_KEY]),
    write: ((v: string) => ({ [TAB_STRIP_MODE_KEY]: v })) as Shared["write"],
  },
  prefixTap: choice(PREFIX_TAP_PRESENTATION_KEY, PREFIX_TAP_PRESENTATIONS, (raw) =>
    normalizePrefixTapPresentation(raw ?? DEFAULT_PREFIX_TAP_PRESENTATION),
  ),
  remoteProjects: bool("experimental.remoteProjects", false),
  autoStatus: bool(AUTO_STATUS_KEY, false),
  dispatcher: bool(DISPATCHER_KEY, false),
}

/** Read-only facts the rows show next to a knob; never an editable value. */
export function prefInfo(state: StateSnapshot): { editorCustomSet: boolean; worktreeCustomPath: string } {
  return { editorCustomSet: text(state[EDITOR_CUSTOM_KEY]).length > 0, worktreeCustomPath: worktreeCustomPath(state) }
}

/** A `value` that fits the definition, or BAD_ARGS. Numbers on enum keys must be listed (e.g. 0.4). */
export function checkPrefValue(name: string, def: PrefDef, value: unknown, themes: readonly string[]): Scalar {
  const bad = (why: string): never => {
    throw new BridgeError("BAD_ARGS", `${name} ${why}`)
  }
  if (def.kind === "bool") return typeof value === "boolean" ? value : bad("must be a boolean")
  if (def.kind === "int") {
    if (typeof value !== "number" || !Number.isInteger(value)) return bad("must be an integer")
    return value < def.min || value > def.max ? bad(`must be ${def.min}–${def.max}`) : value
  }
  const choices = def.choices(themes)
  if ((typeof value === "string" || typeof value === "number") && choices.includes(value)) return value
  return bad(`must be one of ${choices.join("|")}`)
}
