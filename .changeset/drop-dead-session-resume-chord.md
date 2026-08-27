---
"@sma1lboy/rove": patch
---

The F1 keymap no longer advertises `ctrl+y` (resume a prior session).

The `chat.session.resume` row shipped with full i18n but no handler was ever
registered, so pressing the chord did nothing while the live keymap kept
promising it worked. The row and both locale strings are removed; the docs
already dropped the chord in the docs audit. The chord rationale and history
live in `docs/design/keybinding-decisions.md` for whenever the session picker
actually gets built.
