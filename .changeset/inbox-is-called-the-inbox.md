---
"@sma1lboy/rove": patch
---

F1 says the right-click menu exists, and the Inbox is called the Inbox.

Nothing in the running TUI ever mentioned right-click — not F1, not the status
bar, not the pane hints, not the first-run wizard — while six sidebar verbs
(`Set status`, `Copy branch name`, `Copy path`, `Run again`, `Field notes`,
`Sync with base`) are reachable no other way. F1's grammar line, the sentence
that already names the direct, one-press and prefix layers, now names the menu
as the fourth.

The Inbox rename never reached the strings that describe it: `⌃ A + i Open
attention Inbox` rendered on the same frame as `ROVE INBOX 0`. All five
`inbox.*` / `attention.next` descriptions say Inbox now, matching the sidebar,
`docs/TUI.md`, and the keymap's own `description` fields.

F1 also headed the Inbox rows `OTHER PANE — Dialog`: `scopeCategory` had no
`inbox` case and fell through to a default no scope ever meant. It is a
`Record` over the closed scope union now, so the next scope added is a compile
error rather than a wrong-but-plausible header, and `Dialog` — which no binding
declares and nothing else produced — is gone from the catalogue with it.
