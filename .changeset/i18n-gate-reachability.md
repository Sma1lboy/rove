---
"@sma1lboy/rove": patch
---

Close the hole the i18n gate's own comment described, and stop a Chinese label
from being cut with no ellipsis.

`check-i18n` validates PARITY — that `en` and `zh` agree with each other — so a
key missing from BOTH locales passes it. `workspace.reopenSession` had no
`keys.desc` entry in either, and because `tKeys()` falls back to the raw lookup
key, the F1 help dialog printed the literal string `workspace.reopenSession` as
that binding's description, in both languages. The binding's real English
sentence has been sitting unused in the keymap table the whole time; the help
dialog never reads it. Two keymap categories (`Diff review`, `Inbox`) had the
same gap, unreached only by accident of which surfaces are wired today.

`test/tui/i18n-key-resolution.test.ts` now covers what it previously carved out
by name: every binding id must resolve in `keys.desc`, and every category header
any surface can print — the help dialog's scope mapping, the prefix HUD's guide
mapping, and the keymap's own `category` field — must resolve in `keys.category`.
Deleting a `keys.desc` entry from both locales keeps `check-i18n` green and now
fails this test, which is the shape of failure it exists to catch. The two
category mappers moved to the framework-free `lib/help-groups.ts` so the guard
can ask them directly instead of duplicating their literals.

The prefix HUD's stroke echo fed a CELL budget into a code-point truncator, so a
Chinese caption "fit" and Yoga then sheared it: `ctrl+a + 2 → 打开例行任务（`,
ending on an opening full-width bracket with nothing to say the rest was
dropped, where English got a clean `Open routine…`. Same mismatch in
`truncateTitle`, whose budget every caller measures with `approxCellWidth`.

The Routines schedule preview, its relative clocks, and the modals the Settings
screen opens are no longer English-only inside a translated UI. Two
`toLocale*` calls passed no locale at all and followed the OS rather than the UI
setting — wrong in both directions — and the next-run date built its word order
from an English weekday/month table; it now comes from `Intl` for the active
locale, so zh reads `2026/8/3` rather than `8/3/2026`. The Work Items page's
private copy of `relativeAge` (which rounded where every other age on screen
floors) is gone in favour of the shared clock.
