/**
 * CI guard: every i18n key referenced in source resolves in the catalog.
 *
 * The parity gate (`i18n-catalog.test.ts`) only checks that `en` and every
 * other locale agree with EACH OTHER. It cannot catch a `t("foo.bar")` added
 * to code whose key is missing from BOTH catalogs: parity still passes (both
 * sides lack it equally), yet `t()` falls back to the raw dotted key and the
 * UI renders `foo.bar` literally — the exact silent failure the i18n runtime's
 * fallback is meant to make loud, surfaced one layer too late (at runtime, in
 * front of the user, instead of in CI).
 *
 * This scans `src/tui/**` and `src/tui-react/**` for the i18n call sites and
 * fails on any key that doesn't resolve in English:
 *   - literal `t("…")` / `t('…')` calls,
 *   - `labelKey: "…"` table entries, whose `t(row.labelKey)` call site has no
 *     literal of its own, and
 *   - the enumerable dynamic `t()` template families
 *     (`settings.sections.<id>`, `settings.general.accent<Slot>`,
 *     `automations.schedule.dow.<CODE>`, `automations.runStatus.<status>`),
 *     checked against their runtime value sets so a new section, accent slot,
 *     weekday, or daemon run status can't ship a key with no catalog entry.
 *
 * `tKeys("category"|"desc", id)` has no static key to scan — it is only ever
 * called with a dynamic keybinding id — so it gets its own reachability tests
 * at the bottom of this file, driven from the keymap and the two category
 * mappers instead of from source text. Without them the same silent failure
 * reappears one layer over: `workspace.reopenSession` had no `keys.desc`
 * entry in EITHER locale, so parity passed while the F1 help dialog printed
 * the literal binding id as that row's description.
 *
 * Those two tests check `en` only, and that is not a gap: `zh: typeof en` in
 * `messages/keys.ts` makes a locale missing a key a TYPE error, and the
 * parity test covers it at runtime as well.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { AutomationRunStatus } from "@sma1lboy/kobe-daemon/daemon/contracts"
import { describe, expect, test } from "vitest"
import { DOW_CODES } from "../../src/tui/component/cron-segments"
import { SECTIONS } from "../../src/tui/component/settings-dialog/model"
import { KobeKeymap } from "../../src/tui/context/keybindings"
import type { KobeBindingScope } from "../../src/tui/context/keybindings"
import { en } from "../../src/tui/i18n/catalog"
import { UI_PREFS_FOCUS_ACCENT_SLOTS } from "../../src/tui/lib/apply-ui-prefs"
import { guideCategory, scopeCategory } from "../../src/tui/lib/help-groups"

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url))

/** Both TUI trees: the legacy `src/tui` (which still owns the i18n catalog and
 *  the dialogs) and `src/tui-react`, the active React UI. Scanning only the
 *  first let `tui-react` ship keys with no catalog entry. */
const TUI_ROOTS = [join(SRC_ROOT, "tui"), join(SRC_ROOT, "tui-react")]

/** Top-level catalog namespaces — a literal `t()` key starting with one of
 *  these is unambiguously an i18n key (and not some other `t(`-shaped call). */
const NAMESPACES = Object.keys(en)

/** Flatten a nested message object into dotted `a.b.c` keys. */
function flatten(obj: unknown, prefix = "", out: Set<string> = new Set()): Set<string> {
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === "object") flatten(value, path, out)
    else out.add(path)
  }
  return out
}

const VALID_KEYS = flatten(en)

/** Whether a captured literal looks like an i18n key (vs. an unrelated `t(`). */
function isI18nKey(key: string): boolean {
  return NAMESPACES.some((ns) => key === ns || key.startsWith(`${ns}.`))
}

function listSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) listSources(full, acc)
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

/** Capture the first string-literal argument of every `t("…")` / `t('…')`
 *  call. `\bt\(` ignores `tKeys(` (no `t(` boundary) and `format(` (`t` mid-word). */
const T_CALL_RE = /\bt\(\s*["']([^"'\n]+)["']/g

/** Keys parked in a lookup table and passed to `t()` indirectly — e.g. the
 *  Kanban card's `ACTIVITY_BADGE[state].labelKey`, whose `t(badge.labelKey)`
 *  call site carries no literal for `T_CALL_RE` to see. */
const LABEL_KEY_RE = /\blabelKey:\s*["']([^"'\n]+)["']/g

/** Every literal i18n key referenced under the TUI trees, with the files using it. */
function collectLiteralKeys(): Map<string, string[]> {
  const keyToFiles = new Map<string, string[]>()
  for (const root of TUI_ROOTS) {
    for (const file of listSources(root)) {
      const source = readFileSync(file, "utf8")
      const rel = file.slice(SRC_ROOT.length + 1)
      for (const re of [T_CALL_RE, LABEL_KEY_RE]) {
        for (const match of source.matchAll(re)) {
          const key = match[1] as string
          if (!isI18nKey(key)) continue
          const files = keyToFiles.get(key) ?? []
          if (!files.includes(rel)) files.push(rel)
          keyToFiles.set(key, files)
        }
      }
    }
  }
  return keyToFiles
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * The daemon's run-status union as a runtime list. Written as an exhaustive
 * `Record` on purpose: adding a status to `AutomationRunStatus` without
 * listing it here is a TYPE error, so the catalog check below cannot quietly
 * stop covering the full enum.
 */
const RUN_STATUS_KEYS: Record<AutomationRunStatus, true> = {
  dispatched: true,
  skipped_cancelled: true,
  revived: true,
  deferred: true,
  skipped_precheck: true,
  skipped_missed: true,
  skipped_unavailable: true,
  dispatch_failed: true,
}
const AUTOMATION_RUN_STATUSES = Object.keys(RUN_STATUS_KEYS)

describe("i18n key resolution", () => {
  test('every literal t("…") key resolves in the English catalog', () => {
    const keyToFiles = collectLiteralKeys()
    expect(keyToFiles.size).toBeGreaterThan(0) // the scan actually found call sites

    const unresolved = [...keyToFiles.entries()]
      .filter(([key]) => !VALID_KEYS.has(key))
      .map(([key, files]) => `${key} (used in ${files.join(", ")})`)
      .sort()

    expect(unresolved).toEqual([])
  })

  // `settings.sections.${s.id}` in settings-dialog/sections.tsx.
  test("every settings section id has a catalog label", () => {
    const unresolved = SECTIONS.map((s) => `settings.sections.${s.id}`).filter((key) => !VALID_KEYS.has(key))
    expect(unresolved).toEqual([])
  })

  // `automations.schedule.dow.${code}` in component/cron-segments.ts.
  test("every cron weekday code has a catalog phrase", () => {
    const unresolved = DOW_CODES.map((code) => `automations.schedule.dow.${code}`).filter((key) => !VALID_KEYS.has(key))
    expect(unresolved).toEqual([])
  })

  // `automations.runStatus.${status}` in component/automations-format.ts.
  // Driven from the daemon's own union so a status added there cannot reach
  // the Routines page with no catalog entry — `formatRunStatus` would then
  // print the raw `skipped_unavailable` into a Chinese row.
  test("every daemon run status has a catalog label", () => {
    const unresolved = AUTOMATION_RUN_STATUSES.map((status) => `automations.runStatus.${status}`).filter(
      (key) => !VALID_KEYS.has(key),
    )
    expect(unresolved).toEqual([])
  })

  // `settings.general.accent${Slot}` in settings-dialog/sections.tsx.
  test("every focus-accent slot has a catalog label", () => {
    const unresolved = UI_PREFS_FOCUS_ACCENT_SLOTS.map((slot) => `settings.general.accent${capitalize(slot)}`).filter(
      (key) => !VALID_KEYS.has(key),
    )
    expect(unresolved).toEqual([])
  })
})

/**
 * Every scope a section can carry, plus the `undefined` the help dialog
 * passes for an unscoped section. Typed as the real union so adding a scope
 * to `KobeBindingScope` fails to compile here until it is listed.
 */
const HELP_SCOPES: readonly (KobeBindingScope | undefined)[] = [
  undefined,
  "global",
  "sidebar",
  "workspace",
  "files",
  "inbox",
  "terminal",
]

describe("keybinding catalog reachability", () => {
  test("every binding id has a keys.desc entry", () => {
    expect(KobeKeymap.length).toBeGreaterThan(0)
    const missing = KobeKeymap.map((binding) => binding.id)
      .filter((id) => !(id in en.keys.desc))
      .sort()

    // tKeys() falls back to the raw key, which for this group IS the binding
    // id — so a miss here renders `workspace.reopenSession` to the user where
    // a sentence belongs. The binding's own English `description:` field is
    // never displayed; the catalog is the only source the help dialog reads.
    expect(missing).toEqual([])
  })

  test("every category header a surface can print has a keys.category entry", () => {
    // Three sources, because three different rules pick the header: the help
    // dialog groups by SCOPE, the prefix HUD's guide by its own synthetic
    // mapping, and that mapping falls through to the binding's own category.
    const reachable = new Set<string>([
      ...HELP_SCOPES.map(scopeCategory),
      ...KobeKeymap.map((binding) => guideCategory(binding.id)),
      ...KobeKeymap.map((binding) => binding.category),
    ])
    const missing = [...reachable].filter((category) => !(category in en.keys.category)).sort()

    expect(missing).toEqual([])
  })

  test("every pane scope prints its own name as the section header", () => {
    // The test above cannot catch a scope routed to the WRONG header: a
    // fallthrough default is itself a valid catalogue string, which is how
    // the Inbox section shipped titled `OTHER PANE — Dialog`. So assert the
    // header names the scope it heads, not merely that it resolves.
    const mislabelled = HELP_SCOPES.filter((scope) => scope !== undefined).filter(
      (scope) => scopeCategory(scope).toLowerCase() !== scope,
    )

    expect(mislabelled).toEqual([])
  })
})
