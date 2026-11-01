---
"@sma1lboy/rove": patch
---

Search what you and the agents wrote in every task's conversation: `rove api search --query TEXT`, and a Search page in the web rail. Tool output is left out; a hit opens its task. Claude sessions no longer show injected `<system-reminder>` context as something the user typed (it reached `read-output` and auto-title too).
