/**
 * The Routines page's clocks, in both locales.
 *
 * These three formatters produced the last English text on an otherwise
 * translated page — `in 5m`, a raw `skipped_precheck`, and a `toLocaleDateString()`
 * with NO locale argument, which follows the machine rather than the UI
 * setting and is therefore wrong in both directions: a zh UI on an `en-US`
 * box printed `8/3/2026`, an en UI on a `zh-CN` box printed `2026/8/3`.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { formatRunStatus, formatWhen } from "../../src/tui-react/component/automations-format"
import { currentLang, setLocaleLang, t } from "../../src/tui/i18n"

const NOW = new Date(2026, 6, 31, 10, 0, 0).getTime()
const iso = (deltaMs: number): string => new Date(NOW + deltaMs).toISOString()
const ASCII_LETTER = /[A-Za-z]/

describe("formatWhen", () => {
  let restore = currentLang()
  beforeEach(() => {
    restore = currentLang()
  })
  afterEach(() => setLocaleLang(restore))

  test("English keeps its current phrasing", () => {
    setLocaleLang("en")
    expect(formatWhen(iso(5 * 60_000), NOW)).toBe("in 5m")
    expect(formatWhen(iso(-12 * 60_000), NOW)).toBe("12m ago")
    expect(formatWhen(iso(3 * 3_600_000), NOW)).toBe("in 3h")
    expect(formatWhen(iso(-3 * 3_600_000), NOW)).toBe("3h ago")
  })

  test("Chinese carries no English, including the >24h date fallback", () => {
    setLocaleLang("zh")
    for (const delta of [0, 5 * 60_000, -12 * 60_000, 3 * 3_600_000, -3 * 3_600_000]) {
      expect(formatWhen(iso(delta), NOW), String(delta)).not.toMatch(ASCII_LETTER)
    }
    // The fallback formats through Intl for the UI locale; zh-CN puts the
    // year first, which an OS-locale `en-US` box would never produce.
    expect(formatWhen(iso(3 * 24 * 3_600_000), NOW)).toBe("2026/8/3")
  })

  test("an absent or unparsable timestamp is an absence, never a fake now", () => {
    expect(formatWhen(undefined, NOW)).toBe("—")
    expect(formatWhen("not-a-date", NOW)).toBe("—")
  })
})

describe("formatRunStatus", () => {
  test("maps the daemon enum through the catalog", () => {
    setLocaleLang("en")
    expect(formatRunStatus("skipped_precheck", t)).toBe("skipped (precheck)")
    setLocaleLang("zh")
    expect(formatRunStatus("skipped_precheck", t)).toBe("已跳过（预检）")
    setLocaleLang("en")
  })

  test("an unmapped status falls through to its raw value, loudly", () => {
    // A status the daemon adds and the catalog has not caught up with must
    // still print something the reader can search for — never a blank cell.
    expect(formatRunStatus("invented_status", t)).toBe("invented_status")
  })
})
