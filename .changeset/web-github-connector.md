---
"@sma1lboy/rove": patch
---

The web client has a new Settings → Connectors section whose GitHub card shows Rove's account (this machine's own `gh` login) and every registered machine under it, each marked as the same account, a different one, signed out, without `gh`, running an older Rove, or offline: Connect runs GitHub's device flow here (code and link shown in the card) and then signs in the registered machines that are signed out, a machine on another account gets **Use Rove's account** or **Log in there**, and Disconnect signs `gh` out after asking; Rove keeps no token of its own, the machines' credentials stay in each machine's `gh`, and the same is scriptable as `rove api github-status`, `github-login`, `github-logout` and `github-sync --to <alias>`, with a new `credentials` class for `rove machine inbound deny`.
