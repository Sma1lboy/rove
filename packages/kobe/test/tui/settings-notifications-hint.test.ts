/**
 * The Settings notifications hint once promised "the tab-chip unread dot is
 * always on" — but no UI renders that in-memory unread map (the tab chips
 * derive from the persisted seen-tabs timestamps instead, docs/TUI.md). The
 * copy must not resurrect the promise; both locales carry the same hint.
 */

import { describe, expect, test } from "vitest"
import { en, zh } from "../../src/tui/i18n/messages/settings"

describe("settings.general.notificationsHint", () => {
  test("promises no tab-chip unread dot in either locale", () => {
    expect(en.general.notificationsHint).not.toMatch(/unread dot/i)
    expect(zh.general.notificationsHint).not.toContain("未读圆点")
  })

  test("both locales describe the same trigger", () => {
    expect(en.general.notificationsHint.length).toBeGreaterThan(0)
    expect(zh.general.notificationsHint.length).toBeGreaterThan(0)
  })
})
