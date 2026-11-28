---
"@sma1lboy/rove": patch
---

[cli] [web] [tui] Plugin engines can declare `model_flag` and `models_command` in `[[engines]]`, so a session can pin one of their models and the New session menu lists them. Contrib and plugin engines now get every engine capability Rove adds, without a separate copy of each one.
