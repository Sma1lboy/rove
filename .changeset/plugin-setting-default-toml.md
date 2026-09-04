---
"@sma1lboy/rove": patch
---

`[[settings]] default` accepts TOML booleans and numbers. `type = "boolean"`
invites writing `default = true`, which failed the whole manifest with
"`settings[0].default` must be a non-empty string" — and nothing in the
reference said the value had to be quoted. `true` now stores as `"1"` (the
spelling a boolean setting is read back as), `false` as no default, and a
number as its decimal spelling.
